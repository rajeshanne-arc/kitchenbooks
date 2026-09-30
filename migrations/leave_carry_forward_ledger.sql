-- Explicit year-end leave carry-forward evidence.
-- A balance is a year-to-year accounting decision, not a value to silently
-- recalculate forever from mutable policy history. One entry is recorded for
-- each staff member and year pair; corrections require a reviewed replacement
-- in a later migration rather than editing the original evidence.
begin;

create table if not exists public.leave_carry_forward_ledger (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  staff_id uuid not null,
  source_year integer not null check (source_year between 2000 and 2200),
  target_year integer not null check (target_year = source_year + 1),
  carried_days numeric(6,2) not null check (carried_days >= 0),
  note text,
  entered_by text not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, staff_id, source_year, target_year),
  foreign key (restaurant_id, staff_id)
    references public.staff (restaurant_id, id)
);

create index if not exists leave_carry_forward_lookup
  on public.leave_carry_forward_ledger (restaurant_id, target_year, staff_id);

alter table public.leave_carry_forward_ledger enable row level security;
alter table public.leave_carry_forward_ledger force row level security;
drop policy if exists tenant_isolation on public.leave_carry_forward_ledger;
create policy tenant_isolation on public.leave_carry_forward_ledger
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

grant select, insert on public.leave_carry_forward_ledger to kb_app;
commit;
