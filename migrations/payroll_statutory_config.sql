-- Accountant-entered statutory assumptions. These are configuration evidence,
-- not a tax engine: payroll continues to use the explicit withholding amount
-- entered on the draft until a future, reviewed calculation contract exists.
begin;
create table if not exists public.payroll_statutory_configs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  effective_from date not null,
  jurisdiction text not null default 'IN',
  pf_employee_pct numeric(7,4),
  pf_employer_pct numeric(7,4),
  pf_wage_cap numeric(14,2),
  esi_employee_pct numeric(7,4),
  esi_employer_pct numeric(7,4),
  esi_wage_cap numeric(14,2),
  tds_regime text,
  note text,
  entered_by text not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, effective_from),
  foreign key (restaurant_id) references public.restaurants(id),
  check (pf_employee_pct is null or pf_employee_pct between 0 and 100),
  check (pf_employer_pct is null or pf_employer_pct between 0 and 100),
  check (esi_employee_pct is null or esi_employee_pct between 0 and 100),
  check (esi_employer_pct is null or esi_employer_pct between 0 and 100),
  check (pf_wage_cap is null or pf_wage_cap >= 0),
  check (esi_wage_cap is null or esi_wage_cap >= 0)
);
create index if not exists payroll_statutory_configs_effective
  on public.payroll_statutory_configs (restaurant_id, effective_from desc);
alter table public.payroll_statutory_configs enable row level security;
alter table public.payroll_statutory_configs force row level security;
drop policy if exists tenant_isolation on public.payroll_statutory_configs;
create policy tenant_isolation on public.payroll_statutory_configs
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
grant select, insert on public.payroll_statutory_configs to kb_app;
commit;
