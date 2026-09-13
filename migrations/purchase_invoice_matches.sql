-- Append-only three-way invoice assessment. A purchase bill remains the
-- source event; this table records what the bill was compared against.
begin;

create table if not exists public.purchase_invoice_matches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  purchase_id uuid not null,
  purchase_order_id uuid,
  status text not null check (status in ('unmatched', 'matched', 'partial', 'exception')),
  quantity_exception boolean not null default false,
  price_exception boolean not null default false,
  snapshot jsonb not null,
  assessed_by text,
  assessed_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, purchase_id),
  foreign key (restaurant_id, purchase_id) references public.purchases (restaurant_id, id),
  foreign key (restaurant_id, purchase_order_id) references public.purchase_orders (restaurant_id, id)
);

alter table public.purchase_invoice_matches enable row level security;
alter table public.purchase_invoice_matches force row level security;
drop policy if exists tenant_isolation on public.purchase_invoice_matches;
create policy tenant_isolation on public.purchase_invoice_matches
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

create index if not exists purchase_invoice_matches_order
  on public.purchase_invoice_matches (restaurant_id, purchase_order_id, assessed_at desc);
grant select, insert on public.purchase_invoice_matches to kb_app;
commit;
