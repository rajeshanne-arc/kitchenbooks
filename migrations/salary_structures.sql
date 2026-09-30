-- Effective-dated salary history. Existing staff.base_salary remains as the
-- compatibility fallback until each person receives a structure.

begin;

create table if not exists public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  staff_id uuid not null,
  effective_from date not null,
  base_salary numeric not null check (base_salary > 0),
  note text,
  entered_by text not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, staff_id, effective_from),
  foreign key (restaurant_id, staff_id) references public.staff(restaurant_id, id)
);

create index if not exists salary_structures_staff_date
  on public.salary_structures (restaurant_id, staff_id, effective_from desc);

alter table public.salary_structures enable row level security;
alter table public.salary_structures force row level security;
drop policy if exists tenant_isolation on public.salary_structures;
create policy tenant_isolation on public.salary_structures
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
grant select, insert on public.salary_structures to kb_app;

commit;
