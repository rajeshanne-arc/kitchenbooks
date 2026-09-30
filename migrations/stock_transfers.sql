-- Immutable movement of an item's recorded storage location.
-- The current stock model has one location per item, so transfers are whole
-- item-stock moves. Partial allocation is refused by the application.
begin;
create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
  transfer_date date not null, from_location_id uuid not null, to_location_id uuid not null,
  note text, entered_by text, created_at timestamptz not null default now(), unique (restaurant_id, id),
  check (from_location_id <> to_location_id),
  foreign key (restaurant_id, from_location_id) references public.storage_locations (restaurant_id, id),
  foreign key (restaurant_id, to_location_id) references public.storage_locations (restaurant_id, id)
);
create table if not exists public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
  transfer_id uuid not null, item_id uuid not null, qty numeric(14,3) not null check (qty > 0),
  unique (restaurant_id, id), unique (restaurant_id, transfer_id, item_id),
  foreign key (restaurant_id, transfer_id) references public.stock_transfers (restaurant_id, id),
  foreign key (restaurant_id, item_id) references public.items (restaurant_id, id)
);
create index if not exists stock_transfers_date on public.stock_transfers (restaurant_id, transfer_date desc, created_at desc);
create index if not exists stock_transfer_lines_item on public.stock_transfer_lines (restaurant_id, item_id, transfer_id);
alter table public.stock_transfers enable row level security;
alter table public.stock_transfers force row level security;
drop policy if exists tenant_isolation on public.stock_transfers;
create policy tenant_isolation on public.stock_transfers using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
alter table public.stock_transfer_lines enable row level security;
alter table public.stock_transfer_lines force row level security;
drop policy if exists tenant_isolation on public.stock_transfer_lines;
create policy tenant_isolation on public.stock_transfer_lines using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
revoke all on public.stock_transfers, public.stock_transfer_lines from kb_app;
grant select, insert on public.stock_transfers, public.stock_transfer_lines to kb_app;
commit;
