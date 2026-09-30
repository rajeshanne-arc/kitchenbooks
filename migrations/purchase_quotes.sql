-- Vendor quotations are commercial evidence, not purchases. They never move
-- stock or payable balances; accepting one only records the decision.

begin;

create table if not exists public.purchase_quotes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  vendor_id uuid not null,
  quote_date date not null,
  valid_until date,
  status text not null default 'draft' check (status in ('draft', 'accepted', 'rejected', 'expired')),
  reference text,
  note text,
  entered_by text not null,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, vendor_id) references public.vendors(restaurant_id, id)
);

create table if not exists public.purchase_quote_lines (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  quote_id uuid not null,
  item_id uuid not null,
  qty numeric not null check (qty > 0),
  rate numeric not null check (rate >= 0),
  note text,
  unique (restaurant_id, id),
  unique (restaurant_id, quote_id, item_id),
  foreign key (restaurant_id, quote_id) references public.purchase_quotes(restaurant_id, id),
  foreign key (restaurant_id, item_id) references public.items(restaurant_id, id)
);

create index if not exists purchase_quotes_recent on public.purchase_quotes (restaurant_id, quote_date desc, created_at desc);
alter table public.purchase_quotes enable row level security;
alter table public.purchase_quotes force row level security;
alter table public.purchase_quote_lines enable row level security;
alter table public.purchase_quote_lines force row level security;
drop policy if exists tenant_isolation on public.purchase_quotes;
drop policy if exists tenant_isolation on public.purchase_quote_lines;
create policy tenant_isolation on public.purchase_quotes using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
create policy tenant_isolation on public.purchase_quote_lines using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
grant select, insert, update on public.purchase_quotes to kb_app;
grant select, insert on public.purchase_quote_lines to kb_app;

commit;
