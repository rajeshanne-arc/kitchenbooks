-- Tenant-owned recurring journal templates and idempotent period runs.
begin;
create table if not exists public.recurring_journal_templates (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
  name text not null, day_of_month smallint not null check (day_of_month between 1 and 28),
  start_date date not null, end_date date, status text not null default 'active' check (status in ('active','paused','retired')),
  created_by text, created_at timestamptz not null default now(), unique (restaurant_id, id),
  check (end_date is null or end_date >= start_date)
);
create table if not exists public.recurring_journal_template_lines (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
  template_id uuid not null, account_id uuid not null, description text, debit numeric(14,2) not null default 0 check (debit >= 0), credit numeric(14,2) not null default 0 check (credit >= 0),
  unique (restaurant_id, id), foreign key (restaurant_id, template_id) references public.recurring_journal_templates (restaurant_id, id), foreign key (restaurant_id, account_id) references public.accounting_accounts (restaurant_id, id),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create table if not exists public.recurring_journal_runs (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id), template_id uuid not null, period_date date not null, journal_entry_id uuid, generated_at timestamptz not null default now(),
  unique (restaurant_id, id), unique (restaurant_id, template_id, period_date),
  foreign key (restaurant_id, template_id) references public.recurring_journal_templates (restaurant_id, id), foreign key (restaurant_id, journal_entry_id) references public.journal_entries (restaurant_id, id)
);
alter table public.recurring_journal_templates enable row level security; alter table public.recurring_journal_templates force row level security;
drop policy if exists tenant_isolation on public.recurring_journal_templates; create policy tenant_isolation on public.recurring_journal_templates using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
alter table public.recurring_journal_template_lines enable row level security; alter table public.recurring_journal_template_lines force row level security;
drop policy if exists tenant_isolation on public.recurring_journal_template_lines; create policy tenant_isolation on public.recurring_journal_template_lines using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
alter table public.recurring_journal_runs enable row level security; alter table public.recurring_journal_runs force row level security;
drop policy if exists tenant_isolation on public.recurring_journal_runs; create policy tenant_isolation on public.recurring_journal_runs using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
revoke all on public.recurring_journal_templates, public.recurring_journal_template_lines, public.recurring_journal_runs from kb_app;
grant select, insert, update on public.recurring_journal_templates to kb_app;
grant select, insert on public.recurring_journal_template_lines, public.recurring_journal_runs to kb_app;
commit;
