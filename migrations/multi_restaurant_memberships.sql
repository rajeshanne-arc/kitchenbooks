-- multi_restaurant_memberships
--
-- Compatibility foundation for multi-restaurant access. A global identity is
-- separated from restaurant membership, while the current app_users row and
-- its columns remain untouched so existing sessions and owner workflows keep
-- working during the transition.
--
-- Apply as the database migration owner, not as kb_app/kitchenbooks_local.

begin;

create table if not exists public.user_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  display_name text not null,
  password_hash text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (id)
);

create unique index if not exists user_accounts_username_lower_uq
  on public.user_accounts (lower(username));

alter table public.user_accounts enable row level security;
alter table public.user_accounts force row level security;

create table if not exists public.restaurant_memberships (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  account_id uuid not null references public.user_accounts(id),
  role text not null check (role in ('owner', 'manager', 'chef', 'store', 'cashier', 'accountant')),
  staff_id uuid null,
  status text not null default 'active' check (status in ('active', 'inactive', 'invited')),
  created_at timestamptz not null default now(),
  unique (restaurant_id, account_id),
  unique (restaurant_id, id),
  foreign key (restaurant_id, staff_id)
    references public.staff (restaurant_id, id)
);

insert into public.user_accounts (id, username, display_name, password_hash, status, created_at)
select id, username, display_name, password_hash, status, created_at
from public.app_users
on conflict (id) do nothing;

-- Existing users are already valid memberships. The composite staff foreign
-- key prevents linking a user's membership to another restaurant's staff row.
insert into public.restaurant_memberships (restaurant_id, account_id, role, staff_id, status, created_at)
select restaurant_id, id, role, staff_id, status, created_at
from public.app_users
on conflict (restaurant_id, account_id) do nothing;

-- Until the application is fully moved to the new tables, all existing auth
-- actions continue to write app_users. Keep both representations equivalent
-- at the database boundary so a newly created or retired account cannot
-- disappear from multi-restaurant login.
create or replace function public.sync_legacy_app_user_to_membership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.user_accounts (id, username, display_name, password_hash, status, created_at)
  values (new.id, new.username, new.display_name, new.password_hash, new.status, new.created_at)
  on conflict (id) do update set
    username = excluded.username,
    display_name = excluded.display_name,
    password_hash = excluded.password_hash,
    status = excluded.status;

  insert into public.restaurant_memberships (restaurant_id, account_id, role, staff_id, status, created_at)
  values (new.restaurant_id, new.id, new.role, new.staff_id, new.status, new.created_at)
  on conflict (restaurant_id, account_id) do update set
    role = excluded.role,
    staff_id = excluded.staff_id,
    status = excluded.status;
  return new;
end;
$$;

drop trigger if exists app_users_membership_sync on public.app_users;
drop trigger if exists app_users_membership_sync on public.app_users;
create trigger app_users_membership_sync
after insert or update on public.app_users
for each row execute function public.sync_legacy_app_user_to_membership();

alter table public.restaurant_memberships enable row level security;
alter table public.restaurant_memberships force row level security;
drop policy if exists tenant_isolation on public.restaurant_memberships;
create policy tenant_isolation on public.restaurant_memberships
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

-- Membership discovery is the deliberate cross-tenant boundary needed before
-- a restaurant is selected. It returns no password material and is not exposed
-- to browser-facing Supabase roles.
drop function if exists public.restaurant_memberships_for_username(text);
create function public.restaurant_memberships_for_username(p_username text)
returns table (restaurant_id uuid, restaurant_name text, role text, staff_id uuid, status text)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select m.restaurant_id, r.name, m.role, m.staff_id, m.status
  from public.restaurant_memberships m
  join public.user_accounts u on u.id = m.account_id
  join public.restaurants r on r.id = m.restaurant_id
  where lower(u.username) = lower(p_username)
    and u.status = 'active'
    and m.status = 'active'
  order by r.name asc;
$$;

revoke all on function public.restaurant_memberships_for_username(text) from public;
revoke all on function public.restaurant_memberships_for_username(text) from anon;
revoke all on function public.restaurant_memberships_for_username(text) from authenticated;
revoke all on function public.restaurant_memberships_for_username(text) from service_role;
grant execute on function public.restaurant_memberships_for_username(text) to kb_app;

create or replace function public.user_account_for_username(p_username text)
returns table (account_id uuid, username text, display_name text, password_hash text, status text)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select id, username, display_name, password_hash, status
  from public.user_accounts
  where lower(username) = lower(p_username)
  limit 1;
$$;

revoke all on function public.user_account_for_username(text) from public;
revoke all on function public.user_account_for_username(text) from anon;
revoke all on function public.user_account_for_username(text) from authenticated;
revoke all on function public.user_account_for_username(text) from service_role;
grant execute on function public.user_account_for_username(text) to kb_app;

create or replace function public.add_restaurant_membership(
  p_actor_username text,
  p_restaurant_id uuid,
  p_account_username text,
  p_role text,
  p_staff_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_ok boolean;
  account_uuid uuid;
  membership_uuid uuid;
begin
  if p_role not in ('owner', 'manager', 'chef', 'store', 'cashier', 'accountant') then
    raise exception 'invalid membership role';
  end if;

  select exists (
    select 1 from public.restaurant_memberships m
    join public.user_accounts a on a.id = m.account_id
    where m.restaurant_id = p_restaurant_id
      and lower(a.username) = lower(p_actor_username)
      and m.role = 'owner'
      and m.status = 'active'
  ) into actor_ok;
  if not actor_ok then raise exception 'only an active owner can add memberships'; end if;

  select id into account_uuid from public.user_accounts
  where lower(username) = lower(p_account_username) and status = 'active';
  if account_uuid is null then raise exception 'account not found'; end if;

  if p_staff_id is not null and not exists (
    select 1 from public.staff where id = p_staff_id and restaurant_id = p_restaurant_id
  ) then
    raise exception 'staff link not found in this restaurant';
  end if;

  insert into public.restaurant_memberships (restaurant_id, account_id, role, staff_id)
  values (p_restaurant_id, account_uuid, p_role, p_staff_id)
  returning id into membership_uuid;
  return membership_uuid;
exception
  when unique_violation then raise exception 'that account already belongs to this restaurant';
end;
$$;

revoke all on function public.add_restaurant_membership(text, uuid, text, text, uuid) from public;
revoke all on function public.add_restaurant_membership(text, uuid, text, text, uuid) from anon;
revoke all on function public.add_restaurant_membership(text, uuid, text, text, uuid) from authenticated;
revoke all on function public.add_restaurant_membership(text, uuid, text, text, uuid) from service_role;
grant execute on function public.add_restaurant_membership(text, uuid, text, text, uuid) to kb_app;

create or replace function public.restaurant_memberships_for_owner(
  p_actor_username text,
  p_restaurant_id uuid
)
returns table (membership_id uuid, username text, display_name text, role text, staff_id uuid, status text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.restaurant_memberships m
    join public.user_accounts a on a.id = m.account_id
    where m.restaurant_id = p_restaurant_id
      and lower(a.username) = lower(p_actor_username)
      and m.role = 'owner' and m.status = 'active'
  ) then
    raise exception 'only an active owner can list memberships';
  end if;
  return query
    select m.id, a.username, a.display_name, m.role, m.staff_id, m.status
    from public.restaurant_memberships m
    join public.user_accounts a on a.id = m.account_id
    where m.restaurant_id = p_restaurant_id
    order by (m.status = 'active') desc, m.role asc, a.username asc;
end;
$$;

create or replace function public.set_restaurant_membership_status(
  p_actor_username text,
  p_restaurant_id uuid,
  p_membership_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_role text;
  target_status text;
  active_owners bigint;
begin
  if p_status not in ('active', 'inactive') then raise exception 'invalid membership status'; end if;
  if not exists (
    select 1 from public.restaurant_memberships m
    join public.user_accounts a on a.id = m.account_id
    where m.restaurant_id = p_restaurant_id
      and lower(a.username) = lower(p_actor_username)
      and m.role = 'owner' and m.status = 'active'
  ) then
    raise exception 'only an active owner can change memberships';
  end if;

  select role, status into target_role, target_status
  from public.restaurant_memberships
  where id = p_membership_id and restaurant_id = p_restaurant_id
  for update;
  if target_role is null then raise exception 'membership not found'; end if;
  if target_status = p_status then return; end if;
  if target_role = 'owner' and target_status = 'active' and p_status = 'inactive' then
    select count(*) into active_owners from public.restaurant_memberships
    where restaurant_id = p_restaurant_id and role = 'owner' and status = 'active';
    if active_owners <= 1 then raise exception 'cannot retire the last active owner'; end if;
  end if;
  update public.restaurant_memberships set status = p_status
  where id = p_membership_id and restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function public.restaurant_memberships_for_owner(text, uuid) from public;
revoke all on function public.restaurant_memberships_for_owner(text, uuid) from anon;
revoke all on function public.restaurant_memberships_for_owner(text, uuid) from authenticated;
revoke all on function public.restaurant_memberships_for_owner(text, uuid) from service_role;
grant execute on function public.restaurant_memberships_for_owner(text, uuid) to kb_app;
revoke all on function public.set_restaurant_membership_status(text, uuid, uuid, text) from public;
revoke all on function public.set_restaurant_membership_status(text, uuid, uuid, text) from anon;
revoke all on function public.set_restaurant_membership_status(text, uuid, uuid, text) from authenticated;
revoke all on function public.set_restaurant_membership_status(text, uuid, uuid, text) from service_role;
grant execute on function public.set_restaurant_membership_status(text, uuid, uuid, text) to kb_app;

create or replace function public.provision_restaurant(
  p_name text,
  p_owner_username text,
  p_owner_display_name text,
  p_owner_password_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_restaurant_id uuid;
  section_row record;
begin
  if length(btrim(p_name)) < 2 or length(btrim(p_name)) > 120 then raise exception 'restaurant name is invalid'; end if;
  if length(btrim(p_owner_username)) < 3 or length(btrim(p_owner_username)) > 30 then raise exception 'owner username is invalid'; end if;
  if length(btrim(p_owner_display_name)) < 1 then raise exception 'owner display name is required'; end if;
  if length(p_owner_password_hash) < 20 then raise exception 'owner password hash is invalid'; end if;

  insert into public.restaurants (name) values (btrim(p_name)) returning id into new_restaurant_id;

  insert into public.settings (restaurant_id, key, value) values
    (new_restaurant_id, 'timezone', 'Asia/Kolkata'),
    (new_restaurant_id, 'business_day_start', '05:00'),
    (new_restaurant_id, 'standard_hours_per_day', '8'),
    (new_restaurant_id, 'fy_start_month', '4'),
    (new_restaurant_id, 'input_tax_creditable', 'true'),
    (new_restaurant_id, 'pos_stock_policy', 'reconcile');

  for section_row in
    select * from (values
      ('SI','South Indian','Kitchen','kitchen',true,true,1),
      ('NI','North Indian','Kitchen','kitchen',true,true,2),
      ('CH','Chinese','Kitchen','kitchen',true,true,3),
      ('CT','Continental','Kitchen','kitchen',true,true,4),
      ('TD','Tandoor','Kitchen','kitchen',true,true,5),
      ('BK','Bakery','Kitchen','kitchen',true,true,6),
      ('BR','Bar','Bar','operational',true,true,7),
      ('SF','Staff Food','Service','operational',false,true,8),
      ('KS','Kitchen Support','Support','operational',false,true,9),
      ('SV','Service','Service','operational',false,true,10),
      ('HK','Housekeeping','Support','operational',false,true,11),
      ('MG','Management','Management','operational',false,true,12),
      ('ST','Store','Support','operational',false,false,13),
      ('AC','Accounts','Support','operational',false,false,14),
      ('VL','Valet','Service','operational',false,false,15),
      ('SC','Security','Support','operational',false,false,16)
    ) as s(code, name, dept_group, dept_kind, codes_dishes, receives_stock, sort_order)
  loop
    insert into public.sections (restaurant_id, code, name, dept_group, dept_kind, codes_dishes, receives_stock, sort_order)
    values (new_restaurant_id, section_row.code, section_row.name, section_row.dept_group, section_row.dept_kind,
            section_row.codes_dishes, section_row.receives_stock, section_row.sort_order);
  end loop;

  insert into public.app_users (restaurant_id, username, display_name, role, password_hash)
  values (new_restaurant_id, lower(btrim(p_owner_username)), btrim(p_owner_display_name), 'owner', p_owner_password_hash);
  return new_restaurant_id;
exception
  when unique_violation then raise exception 'restaurant or owner username already exists';
end;
$$;

revoke all on function public.provision_restaurant(text, text, text, text) from public;
revoke all on function public.provision_restaurant(text, text, text, text) from anon;
revoke all on function public.provision_restaurant(text, text, text, text) from authenticated;
revoke all on function public.provision_restaurant(text, text, text, text) from service_role;
grant execute on function public.provision_restaurant(text, text, text, text) to kb_app;

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.user_accounts(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now()
);

alter table public.password_reset_tokens enable row level security;
alter table public.password_reset_tokens force row level security;

create or replace function public.issue_password_reset_token(
  p_actor_username text,
  p_restaurant_id uuid,
  p_target_username text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare target_account uuid;
begin
  if not exists (
    select 1 from public.restaurant_memberships m
    join public.user_accounts a on a.id = m.account_id
    where m.restaurant_id = p_restaurant_id and lower(a.username) = lower(p_actor_username)
      and m.role = 'owner' and m.status = 'active'
  ) then raise exception 'only an active owner can issue reset links'; end if;
  select a.id into target_account
  from public.user_accounts a
  join public.restaurant_memberships m on m.account_id = a.id
  where m.restaurant_id = p_restaurant_id and lower(a.username) = lower(p_target_username)
    and a.status = 'active' and m.status = 'active';
  if target_account is null then raise exception 'account not found'; end if;
  update public.password_reset_tokens set used_at = now()
  where account_id = target_account and used_at is null;
  insert into public.password_reset_tokens (account_id, token_hash, expires_at)
  values (target_account, p_token_hash, p_expires_at);
end;
$$;

create or replace function public.consume_password_reset_token(
  p_token_hash text,
  p_password_hash text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare target_account uuid;
begin
  select account_id into target_account from public.password_reset_tokens
  where token_hash = p_token_hash and used_at is null and expires_at > now()
  for update;
  if target_account is null then raise exception 'reset link is invalid or expired'; end if;
  update public.user_accounts set password_hash = p_password_hash where id = target_account and status = 'active';
  if not found then raise exception 'account is no longer active'; end if;
  update public.app_users set password_hash = p_password_hash where id = target_account;
  update public.password_reset_tokens set used_at = now() where token_hash = p_token_hash;
end;
$$;

revoke all on function public.issue_password_reset_token(text, uuid, text, text, timestamptz) from public;
revoke all on function public.issue_password_reset_token(text, uuid, text, text, timestamptz) from anon;
revoke all on function public.issue_password_reset_token(text, uuid, text, text, timestamptz) from authenticated;
revoke all on function public.issue_password_reset_token(text, uuid, text, text, timestamptz) from service_role;
grant execute on function public.issue_password_reset_token(text, uuid, text, text, timestamptz) to kb_app;
revoke all on function public.consume_password_reset_token(text, text) from public;
revoke all on function public.consume_password_reset_token(text, text) from anon;
revoke all on function public.consume_password_reset_token(text, text) from authenticated;
revoke all on function public.consume_password_reset_token(text, text) from service_role;
grant execute on function public.consume_password_reset_token(text, text) to kb_app;

commit;
