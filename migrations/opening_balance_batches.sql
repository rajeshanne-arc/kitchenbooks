-- Immutable opening-balance import evidence. The balancing account is not
-- guessed: the CSV itself must balance, so every row is posted as supplied.
begin;
create table if not exists public.opening_balance_batches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  effective_date date not null,
  note text,
  entered_by text not null,
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id) references public.restaurants(id)
);
create table if not exists public.opening_balance_batch_lines (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  batch_id uuid not null,
  account_id uuid not null,
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  unique (restaurant_id, id),
  foreign key (restaurant_id, batch_id) references public.opening_balance_batches(restaurant_id, id),
  foreign key (restaurant_id, account_id) references public.accounting_accounts(restaurant_id, id),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
alter table public.opening_balance_batches enable row level security;
alter table public.opening_balance_batches force row level security;
alter table public.opening_balance_batch_lines enable row level security;
alter table public.opening_balance_batch_lines force row level security;
drop policy if exists tenant_isolation on public.opening_balance_batches;
create policy tenant_isolation on public.opening_balance_batches using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
drop policy if exists tenant_isolation on public.opening_balance_batch_lines;
create policy tenant_isolation on public.opening_balance_batch_lines using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
grant select, insert, update on public.opening_balance_batches to kb_app;
grant select, insert on public.opening_balance_batch_lines to kb_app;
commit;
