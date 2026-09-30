-- Optional owner approval for standalone stock corrections.
-- Count acceptance remains its own explicit workflow: stock_counts already
-- freezes the evidence and records accepted_by.

begin;

create table if not exists public.stock_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  adj_date date not null,
  reason text not null check (length(btrim(reason)) > 0),
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'refused', 'cancelled')),
  requested_by text,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  unique (restaurant_id, id)
);

create table if not exists public.stock_adjustment_request_lines (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  request_id uuid not null,
  item_id uuid not null,
  qty numeric not null check (qty <> 0),
  unit_cost numeric not null check (unit_cost >= 0),
  unique (restaurant_id, id),
  unique (restaurant_id, request_id, item_id),
  foreign key (restaurant_id, request_id)
    references public.stock_adjustment_requests (restaurant_id, id),
  foreign key (restaurant_id, item_id)
    references public.items (restaurant_id, id)
);

create index if not exists stock_adjustment_requests_pending
  on public.stock_adjustment_requests (restaurant_id, requested_at)
  where status = 'pending';

alter table public.stock_adjustment_requests enable row level security;
alter table public.stock_adjustment_requests force row level security;
drop policy if exists tenant_isolation on public.stock_adjustment_requests;
create policy tenant_isolation on public.stock_adjustment_requests
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

alter table public.stock_adjustment_request_lines enable row level security;
alter table public.stock_adjustment_request_lines force row level security;
drop policy if exists tenant_isolation on public.stock_adjustment_request_lines;
create policy tenant_isolation on public.stock_adjustment_request_lines
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

grant select, insert, update on public.stock_adjustment_requests to kb_app;
grant select, insert on public.stock_adjustment_request_lines to kb_app;

insert into public.settings (restaurant_id, key, value)
select r.id, 'stock_adjustment_approval_mode', 'none'
from public.restaurants r
where not exists (
  select 1 from public.settings s
  where s.restaurant_id = r.id and s.key = 'stock_adjustment_approval_mode'
);

commit;
