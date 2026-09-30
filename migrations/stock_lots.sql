-- FEFO-ready lot ledger. Existing aggregate stock is carried into one clearly
-- labelled legacy lot per item; new receipts create dated lots. Movements are
-- append-only signed deltas, so an issue or reversal never edits a lot.
begin;
create table if not exists public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  item_id uuid not null,
  lot_code text not null,
  received_date date not null,
  expiry_date date,
  initial_qty numeric(14,3) not null check (initial_qty > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  location_id uuid,
  source_purchase_line_id uuid,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, item_id, lot_code),
  foreign key (restaurant_id, item_id) references public.items (restaurant_id, id),
  foreign key (restaurant_id, location_id) references public.storage_locations (restaurant_id, id),
  foreign key (restaurant_id, source_purchase_line_id) references public.purchase_lines (restaurant_id, id)
);

create table if not exists public.stock_lot_movements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  lot_id uuid not null,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  movement_date date not null,
  movement_type text not null check (movement_type in ('issue', 'issue_reversal', 'purchase_reversal', 'return', 'department_return', 'wastage', 'wastage_reversal', 'adjustment', 'transfer')),
  location_id uuid,
  from_location_id uuid,
  to_location_id uuid,
  source_id uuid,
  source_line_id uuid,
  entered_by text,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, location_id) references public.storage_locations (restaurant_id, id),
  foreign key (restaurant_id, lot_id) references public.stock_lots (restaurant_id, id)
  , foreign key (restaurant_id, from_location_id) references public.storage_locations (restaurant_id, id)
  , foreign key (restaurant_id, to_location_id) references public.storage_locations (restaurant_id, id)
);

-- Keep reruns safe if the table was created by an earlier draft of this
-- migration before wastage reversals were named separately.
alter table public.stock_lot_movements
  drop constraint if exists stock_lot_movements_movement_type_check;
alter table public.stock_lot_movements
  add constraint stock_lot_movements_movement_type_check
  check (movement_type in ('issue', 'issue_reversal', 'purchase_reversal', 'return', 'department_return', 'wastage', 'wastage_reversal', 'adjustment', 'transfer'));

create index if not exists stock_lots_fefo on public.stock_lots (restaurant_id, item_id, expiry_date, received_date, id);
create index if not exists stock_lot_movements_lot on public.stock_lot_movements (restaurant_id, lot_id, movement_date, created_at);

alter table public.stock_lots enable row level security;
alter table public.stock_lots force row level security;
drop policy if exists tenant_isolation on public.stock_lots;
create policy tenant_isolation on public.stock_lots using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
alter table public.stock_lot_movements enable row level security;
alter table public.stock_lot_movements force row level security;
drop policy if exists tenant_isolation on public.stock_lot_movements;
create policy tenant_isolation on public.stock_lot_movements using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

revoke all on public.stock_lots, public.stock_lot_movements from kb_app;
grant select, insert on public.stock_lots, public.stock_lot_movements to kb_app;

-- Carry forward only the quantity the aggregate book says is currently held.
-- This is intentionally not disguised as historical FIFO reconstruction.
insert into public.stock_lots (restaurant_id, item_id, lot_code, received_date, initial_qty, unit_cost, location_id)
select s.restaurant_id, s.item_id, 'LEGACY-' || s.item_id::text, current_date,
       s.on_hand_qty, coalesce(s.on_hand_value / nullif(s.on_hand_qty, 0), 0), i.storage_location_id
from public.stock_on_hand s
join public.items i on i.restaurant_id = s.restaurant_id and i.id = s.item_id
where s.on_hand_qty > 0
  and not exists (select 1 from public.stock_lots l where l.restaurant_id = s.restaurant_id and l.item_id = s.item_id)
on conflict (restaurant_id, item_id, lot_code) do nothing;
commit;
