-- Restaurant holiday calendar. A paid holiday contributes a paid day to a
-- future payroll draft when no attendance mark exists for that person/date.

begin;
create table if not exists public.staff_holidays (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  holiday_date date not null,
  name text not null,
  paid boolean not null default true,
  entered_by text not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, holiday_date),
  foreign key (restaurant_id) references public.restaurants(id)
);
alter table public.staff_holidays enable row level security;
alter table public.staff_holidays force row level security;
drop policy if exists tenant_isolation on public.staff_holidays;
create policy tenant_isolation on public.staff_holidays using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
grant select, insert on public.staff_holidays to kb_app;
commit;
