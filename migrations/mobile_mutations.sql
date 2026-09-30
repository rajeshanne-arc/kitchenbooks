-- Durable idempotency records for native clients. A mobile request can time
-- out after the database commits; retrying the same client mutation must then
-- return the original result instead of writing a second event.
begin;

create table if not exists public.mobile_mutations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  client_mutation_id text not null,
  operation text not null,
  request_json jsonb not null,
  status text not null default 'processing'
    check (status in ('processing', 'accepted', 'failed')),
  response_json jsonb,
  entered_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (restaurant_id, client_mutation_id)
);

create index if not exists mobile_mutations_recent
  on public.mobile_mutations (restaurant_id, created_at desc);

alter table public.mobile_mutations enable row level security;
alter table public.mobile_mutations force row level security;
drop policy if exists tenant_isolation on public.mobile_mutations;
create policy tenant_isolation on public.mobile_mutations
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

grant select, insert, update on public.mobile_mutations to kb_app;

commit;
