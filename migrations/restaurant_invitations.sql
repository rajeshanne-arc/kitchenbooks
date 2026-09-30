-- One-time restaurant invitations. The bearer link contains only a random
-- token; the database stores its SHA-256 digest and never a usable link.
-- Apply as the database migration owner.

begin;

create table if not exists public.restaurant_invitations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  username text not null,
  display_name text not null,
  role text not null check (role in ('owner', 'manager', 'chef', 'store', 'cashier', 'accountant')),
  staff_id uuid,
  token_hash text not null unique,
  expires_at timestamptz not null,
  invited_by text not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, staff_id) references public.staff(restaurant_id, id)
);

create index if not exists restaurant_invitations_active
  on public.restaurant_invitations (restaurant_id, expires_at)
  where consumed_at is null;

alter table public.restaurant_invitations enable row level security;
alter table public.restaurant_invitations force row level security;
drop policy if exists tenant_isolation on public.restaurant_invitations;
create policy tenant_isolation on public.restaurant_invitations
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

revoke all on public.restaurant_invitations from public, anon, authenticated, service_role;
grant select, insert, update on public.restaurant_invitations to kb_app;

create or replace function public.issue_restaurant_invitation(
  p_actor_username text,
  p_restaurant_id uuid,
  p_username text,
  p_display_name text,
  p_role text,
  p_staff_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare invitation_id uuid;
begin
  if p_role not in ('owner', 'manager', 'chef', 'store', 'cashier', 'accountant') then
    raise exception 'invalid invitation role';
  end if;
  if p_username !~ '^[a-z0-9._-]{3,30}$' then raise exception 'invalid username'; end if;
  if length(trim(p_display_name)) = 0 then raise exception 'display name is required'; end if;
  if p_expires_at <= now() then raise exception 'invitation expiry must be in the future'; end if;
  if not exists (
    select 1 from public.restaurant_memberships m
    join public.user_accounts a on a.id = m.account_id
    where m.restaurant_id = p_restaurant_id and lower(a.username) = lower(p_actor_username)
      and m.role = 'owner' and m.status = 'active'
  ) then raise exception 'only an active owner can issue invitations'; end if;
  if exists (select 1 from public.user_accounts where lower(username) = lower(p_username)) then
    raise exception 'that username already exists — add restaurant access instead';
  end if;
  insert into public.restaurant_invitations
    (restaurant_id, username, display_name, role, staff_id, token_hash, expires_at, invited_by)
  values (p_restaurant_id, lower(p_username), trim(p_display_name), p_role, p_staff_id,
          p_token_hash, p_expires_at, p_actor_username)
  returning id into invitation_id;
  return invitation_id;
end;
$$;

create or replace function public.invitation_for_token(p_token_hash text)
returns table (invitation_id uuid, restaurant_name text, username text, display_name text, role text, expires_at timestamptz)
language sql security definer
set search_path = pg_catalog, public
as $$
  select i.id, r.name, i.username, i.display_name, i.role, i.expires_at
  from public.restaurant_invitations i
  join public.restaurants r on r.id = i.restaurant_id
  where i.token_hash = p_token_hash and i.consumed_at is null and i.expires_at > now();
$$;

create or replace function public.accept_restaurant_invitation(p_token_hash text, p_password_hash text)
returns table (username text, restaurant_id uuid, role text)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare i public.restaurant_invitations%rowtype; account_uuid uuid;
begin
  select * into i from public.restaurant_invitations
  where token_hash = p_token_hash and consumed_at is null and expires_at > now()
  for update;
  if not found then raise exception 'invitation is invalid, expired, or already used'; end if;
  if exists (select 1 from public.user_accounts where lower(user_accounts.username) = lower(i.username)) then
    raise exception 'that username has already been registered';
  end if;
  insert into public.user_accounts (username, display_name, password_hash)
  values (i.username, i.display_name, p_password_hash)
  returning id into account_uuid;
  insert into public.restaurant_memberships (restaurant_id, account_id, role, staff_id, status)
  values (i.restaurant_id, account_uuid, i.role, i.staff_id, 'active');
  update public.restaurant_invitations set consumed_at = now() where id = i.id;
  return query select i.username, i.restaurant_id, i.role;
end;
$$;

revoke all on function public.issue_restaurant_invitation(text, uuid, text, text, text, uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.invitation_for_token(text) from public, anon, authenticated, service_role;
revoke all on function public.accept_restaurant_invitation(text, text) from public, anon, authenticated, service_role;
grant execute on function public.issue_restaurant_invitation(text, uuid, text, text, text, uuid, text, timestamptz) to kb_app;
grant execute on function public.invitation_for_token(text) to kb_app;
grant execute on function public.accept_restaurant_invitation(text, text) to kb_app;

commit;
