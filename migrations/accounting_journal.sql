-- Double-entry accounting foundation.
--
-- Existing operational tables remain the source records for the moment. This
-- migration adds the accounting boundary they can post through as each source
-- workflow is upgraded. No chart of accounts is seeded: account names and
-- local tax treatment belong to the restaurant, not to KitchenBooks.

begin;

create table if not exists public.accounting_accounts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  code text not null,
  name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id uuid,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, code),
  foreign key (restaurant_id, parent_id)
    references public.accounting_accounts (restaurant_id, id)
);

-- Link a physical money account (drawer, bank, wallet) to its ledger asset
-- account. It is nullable so existing history remains intact until a human
-- maps it; the payment posting boundary refuses an unmapped account.
alter table public.money_accounts
  add column if not exists accounting_account_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'money_accounts_accounting_account_fk'
      and conrelid = 'public.money_accounts'::regclass
  ) then
    alter table public.money_accounts
      add constraint money_accounts_accounting_account_fk
      foreign key (restaurant_id, accounting_account_id)
      references public.accounting_accounts (restaurant_id, id);
  end if;
end $$;

create index if not exists accounting_accounts_active
  on public.accounting_accounts (restaurant_id, status, account_type, code);

-- A source workflow may only post when every account it needs has been
-- explicitly mapped by this restaurant. Keys are product-level concepts,
-- not country-specific account names.
create table if not exists public.accounting_posting_mappings (
  restaurant_id uuid not null references public.restaurants(id),
  mapping_key text not null,
  account_id uuid not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, mapping_key),
  foreign key (restaurant_id, account_id)
    references public.accounting_accounts (restaurant_id, id)
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  entry_date date not null,
  source_type text not null,
  source_id uuid,
  memo text not null,
  posted_by text,
  posted_at timestamptz not null default now(),
  reversal_of uuid,
  unique (restaurant_id, id),
  foreign key (restaurant_id, reversal_of)
    references public.journal_entries (restaurant_id, id)
);

create index if not exists journal_entries_date
  on public.journal_entries (restaurant_id, entry_date desc, posted_at desc);
create unique index if not exists journal_entries_source_once
  on public.journal_entries (restaurant_id, source_type, source_id)
  where source_id is not null and reversal_of is null;

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  journal_entry_id uuid not null,
  account_id uuid not null,
  description text,
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  unique (restaurant_id, id),
  foreign key (restaurant_id, journal_entry_id)
    references public.journal_entries (restaurant_id, id),
  foreign key (restaurant_id, account_id)
    references public.accounting_accounts (restaurant_id, id),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create index if not exists journal_lines_account
  on public.journal_lines (restaurant_id, account_id, journal_entry_id);

alter table public.accounting_accounts enable row level security;
alter table public.accounting_accounts force row level security;
drop policy if exists tenant_isolation on public.accounting_accounts;
create policy tenant_isolation on public.accounting_accounts
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

alter table public.accounting_posting_mappings enable row level security;
alter table public.accounting_posting_mappings force row level security;
drop policy if exists tenant_isolation on public.accounting_posting_mappings;
create policy tenant_isolation on public.accounting_posting_mappings
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

alter table public.journal_entries enable row level security;
alter table public.journal_entries force row level security;
drop policy if exists tenant_isolation on public.journal_entries;
create policy tenant_isolation on public.journal_entries
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

alter table public.journal_lines enable row level security;
alter table public.journal_lines force row level security;
drop policy if exists tenant_isolation on public.journal_lines;
create policy tenant_isolation on public.journal_lines
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

-- Journal rows are an audit trail. The application role may only create them
-- through post_journal_entry, never edit or delete a posted line.
revoke all on public.accounting_accounts, public.journal_entries, public.journal_lines from kb_app;
grant select, insert on public.accounting_accounts to kb_app;
grant select, insert, update on public.accounting_posting_mappings to kb_app;
grant update (accounting_account_id) on public.money_accounts to kb_app;
grant select on public.journal_entries, public.journal_lines to kb_app;

create or replace function public.post_journal_entry(
  p_restaurant_id uuid,
  p_entry_date date,
  p_source_type text,
  p_source_id uuid,
  p_memo text,
  p_posted_by text,
  p_lines jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
  v_line jsonb;
begin
  if p_restaurant_id is null
     or nullif(current_setting('app.restaurant_id', true), '') is null
     or p_restaurant_id <> nullif(current_setting('app.restaurant_id', true), '')::uuid then
    raise exception 'tenant announcement does not match journal entry';
  end if;
  if p_memo is null or length(trim(p_memo)) = 0 then
    raise exception 'journal memo is required';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'a journal entry needs at least two lines';
  end if;

  select coalesce(sum((x->>'debit')::numeric), 0),
         coalesce(sum((x->>'credit')::numeric), 0)
    into v_total_debit, v_total_credit
    from jsonb_array_elements(p_lines) x;
  if v_total_debit <= 0 or v_total_debit <> v_total_credit then
    raise exception 'journal entry is not balanced';
  end if;

  if exists (
    select 1 from period_closes
    where restaurant_id = p_restaurant_id
      and reopened_at is null
      and p_entry_date between period_start and period_end
  ) then
    raise exception 'journal entry date is inside a closed period';
  end if;

  insert into journal_entries (restaurant_id, entry_date, source_type, source_id, memo, posted_by)
  values (p_restaurant_id, p_entry_date, trim(p_source_type), p_source_id, trim(p_memo), p_posted_by)
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line->>'account_id') is null
       or not exists (select 1 from accounting_accounts a
                      where a.restaurant_id = p_restaurant_id
                        and a.id = (v_line->>'account_id')::uuid
                        and a.status = 'active') then
      raise exception 'journal line names no active account';
    end if;
    insert into journal_lines (restaurant_id, journal_entry_id, account_id, description, debit, credit)
    values (p_restaurant_id, v_entry_id, (v_line->>'account_id')::uuid,
            nullif(trim(v_line->>'description'), ''),
            coalesce((v_line->>'debit')::numeric, 0),
            coalesce((v_line->>'credit')::numeric, 0));
  end loop;
  return v_entry_id;
exception when others then
  raise;
end;
$$;

revoke all on function public.post_journal_entry(uuid, date, text, uuid, text, text, jsonb) from public;
grant execute on function public.post_journal_entry(uuid, date, text, uuid, text, text, jsonb) to kb_app;

commit;
