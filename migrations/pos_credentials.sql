-- Encrypted, per-restaurant Petpooja credentials. Plaintext never reaches
-- the database or the browser; the application decrypts only at fetch time.

begin;

create table if not exists public.pos_credentials (
  restaurant_id uuid primary key references public.restaurants(id),
  provider text not null default 'petpooja' check (provider = 'petpooja'),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.pos_credentials enable row level security;
alter table public.pos_credentials force row level security;
drop policy if exists tenant_isolation on public.pos_credentials;
create policy tenant_isolation on public.pos_credentials
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

grant select, insert, update on public.pos_credentials to kb_app;

-- A scheduled worker needs tenant ids but must not read credential material.
-- This narrow definer function exposes only restaurants that opted into a
-- configured POS connection; the route still requires its cron secret.
create or replace function public.list_pos_sync_tenants()
returns table (restaurant_id uuid)
language sql
security definer
set search_path = public
as $$
  select restaurant_id from pos_credentials where provider = 'petpooja'
$$;
revoke all on function public.list_pos_sync_tenants() from public;
grant execute on function public.list_pos_sync_tenants() to kb_app;

commit;
