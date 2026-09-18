-- Tenant-owned leave vocabulary and the current policy assigned to each
-- employee. Payroll uses only these explicit values; an unassigned employee
-- receives no paid-leave credit.
begin;

create table if not exists public.leave_policies (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  code text not null,
  name text not null check (length(btrim(name)) > 0),
  annual_days numeric(6,2) not null check (annual_days >= 0),
  paid_days numeric(6,2) not null check (paid_days >= 0 and paid_days <= annual_days),
  carry_forward boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  entered_by text,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, code)
);

create table if not exists public.staff_leave_policy_assignments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  staff_id uuid not null,
  policy_id uuid not null,
  effective_from date not null,
  effective_to date,
  entered_by text,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id),
  foreign key (restaurant_id, policy_id) references public.leave_policies (restaurant_id, id),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists staff_leave_one_current
  on public.staff_leave_policy_assignments (restaurant_id, staff_id)
  where effective_to is null;

alter table public.leave_policies enable row level security;
alter table public.leave_policies force row level security;
drop policy if exists tenant_isolation on public.leave_policies;
create policy tenant_isolation on public.leave_policies
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

alter table public.staff_leave_policy_assignments enable row level security;
alter table public.staff_leave_policy_assignments force row level security;
drop policy if exists tenant_isolation on public.staff_leave_policy_assignments;
create policy tenant_isolation on public.staff_leave_policy_assignments
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

grant select, insert, update on public.leave_policies to kb_app;
grant select, insert, update on public.staff_leave_policy_assignments to kb_app;
commit;
