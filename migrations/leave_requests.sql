-- Controlled leave requests. Approval writes the corresponding immutable
-- attendance marks; rejection leaves the request visible without changing
-- payroll inputs.
begin;
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  staff_id uuid not null,
  policy_id uuid,
  start_date date not null,
  end_date date not null,
  requested_days numeric(6,2) not null check (requested_days > 0),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by text not null,
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id),
  foreign key (restaurant_id, policy_id) references public.leave_policies (restaurant_id, id),
  check (end_date >= start_date)
);
create index if not exists leave_requests_queue on public.leave_requests (restaurant_id, status, start_date);
alter table public.leave_requests enable row level security;
alter table public.leave_requests force row level security;
drop policy if exists tenant_isolation on public.leave_requests;
create policy tenant_isolation on public.leave_requests
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
grant select, insert, update on public.leave_requests to kb_app;
commit;
