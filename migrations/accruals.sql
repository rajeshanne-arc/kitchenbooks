-- Accrual source records and their append-only journal postings.
begin;
create table if not exists public.accruals (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
  name text not null, accrual_date date not null, reversal_date date,
  amount numeric(14,2) not null check (amount > 0), expense_account_id uuid not null,
  liability_account_id uuid not null, status text not null default 'open' check (status in ('open','reversed','retired')),
  created_by text, created_at timestamptz not null default now(), unique (restaurant_id, id),
  check (reversal_date is null or reversal_date >= accrual_date),
  foreign key (restaurant_id, expense_account_id) references public.accounting_accounts (restaurant_id, id),
  foreign key (restaurant_id, liability_account_id) references public.accounting_accounts (restaurant_id, id)
);
create table if not exists public.accrual_postings (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
  accrual_id uuid not null, posting_kind text not null check (posting_kind in ('accrual','reversal')),
  journal_entry_id uuid, posted_at timestamptz not null default now(), unique (restaurant_id, id),
  unique (restaurant_id, accrual_id, posting_kind),
  foreign key (restaurant_id, accrual_id) references public.accruals (restaurant_id, id),
  foreign key (restaurant_id, journal_entry_id) references public.journal_entries (restaurant_id, id)
);
alter table public.accruals enable row level security; alter table public.accruals force row level security;
drop policy if exists tenant_isolation on public.accruals; create policy tenant_isolation on public.accruals using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
alter table public.accrual_postings enable row level security; alter table public.accrual_postings force row level security;
drop policy if exists tenant_isolation on public.accrual_postings; create policy tenant_isolation on public.accrual_postings using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
revoke all on public.accruals, public.accrual_postings from kb_app;
grant select, insert, update on public.accruals to kb_app;
grant select, insert on public.accrual_postings to kb_app;
commit;
