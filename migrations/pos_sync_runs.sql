-- Durable state for manual and scheduled POS synchronization attempts.
-- A failed API call must be visible without inventing a successful fetch row;
-- the existing pos_fetches table remains the immutable payload generation.

begin;

create table if not exists public.pos_sync_runs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  business_date date not null,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  attempt integer not null default 1 check (attempt > 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  fetch_id uuid,
  unique (restaurant_id, id),
  foreign key (restaurant_id) references public.restaurants(id),
  foreign key (restaurant_id, fetch_id)
    references public.pos_fetches (restaurant_id, id)
);

create index if not exists pos_sync_runs_recent
  on public.pos_sync_runs (restaurant_id, business_date, started_at desc);

alter table public.pos_sync_runs enable row level security;
alter table public.pos_sync_runs force row level security;
drop policy if exists tenant_isolation on public.pos_sync_runs;
create policy tenant_isolation on public.pos_sync_runs
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

grant select, insert, update on public.pos_sync_runs to kb_app;

commit;
