-- Fixed-asset register and append-only depreciation postings.
begin;
create table if not exists public.fixed_assets (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
  asset_code text not null, name text not null, purchase_date date not null, in_service_date date not null,
  cost numeric(14,2) not null check (cost > 0), salvage_value numeric(14,2) not null default 0 check (salvage_value >= 0),
  useful_life_months integer not null check (useful_life_months > 0), asset_account_id uuid not null,
  depreciation_expense_account_id uuid not null, accumulated_depreciation_account_id uuid not null,
  status text not null default 'active' check (status in ('active','disposed','retired')), created_by text, created_at timestamptz not null default now(),
  unique (restaurant_id, id), unique (restaurant_id, asset_code), check (in_service_date >= purchase_date), check (salvage_value < cost),
  foreign key (restaurant_id, asset_account_id) references public.accounting_accounts (restaurant_id, id),
  foreign key (restaurant_id, depreciation_expense_account_id) references public.accounting_accounts (restaurant_id, id),
  foreign key (restaurant_id, accumulated_depreciation_account_id) references public.accounting_accounts (restaurant_id, id)
);
create table if not exists public.fixed_asset_depreciation (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id), asset_id uuid not null,
  period_date date not null, amount numeric(14,2) not null check (amount > 0), journal_entry_id uuid,
  posted_at timestamptz not null default now(), unique (restaurant_id, id), unique (restaurant_id, asset_id, period_date),
  foreign key (restaurant_id, asset_id) references public.fixed_assets (restaurant_id, id),
  foreign key (restaurant_id, journal_entry_id) references public.journal_entries (restaurant_id, id)
);
alter table public.fixed_assets enable row level security; alter table public.fixed_assets force row level security;
drop policy if exists tenant_isolation on public.fixed_assets; create policy tenant_isolation on public.fixed_assets using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
alter table public.fixed_asset_depreciation enable row level security; alter table public.fixed_asset_depreciation force row level security;
drop policy if exists tenant_isolation on public.fixed_asset_depreciation; create policy tenant_isolation on public.fixed_asset_depreciation using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
revoke all on public.fixed_assets, public.fixed_asset_depreciation from kb_app;
grant select, insert, update on public.fixed_assets to kb_app;
grant select, insert on public.fixed_asset_depreciation to kb_app;
commit;
