-- Approval event trail and the single queue predicate used by badges/pages.
--
-- The approval request row stores current position; this append-only event
-- table stores who acted and what happened. The view keeps the definition of
-- "waiting on somebody" in one database object.

begin;

create table if not exists public.approval_events (
  seq bigserial primary key,
  restaurant_id uuid not null,
  request_id uuid not null,
  action text not null,
  note text,
  mode text,
  account_id uuid,
  acted_by text,
  acted_at timestamptz not null default now(),
  unique (restaurant_id, seq),
  foreign key (restaurant_id, request_id)
    references public.approval_requests (restaurant_id, id),
  foreign key (restaurant_id, account_id)
    references public.money_accounts (restaurant_id, id)
);

-- Historical states remain readable even when the current UI no longer
-- creates them. Removing one strands old requests in the table.
alter table public.approval_requests drop constraint if exists approval_requests_status_check;
alter table public.approval_requests add constraint approval_requests_status_check
  check (status = any (array[
    'pending', 'approved', 'refused', 'applied', 'failed', 'cancelled',
    'returned', 'challenged'
  ]));

create index if not exists approval_events_request
  on public.approval_events (restaurant_id, request_id, acted_at desc, seq desc);

alter table public.approval_events enable row level security;
alter table public.approval_events force row level security;
drop policy if exists tenant_isolation on public.approval_events;
create policy tenant_isolation on public.approval_events
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

grant select, insert on public.approval_events to kb_app;
grant usage, select on sequence public.approval_events_seq_seq to kb_app;

create or replace view public.awaiting_me
with (security_invoker = true)
as
select restaurant_id,
       assigned_to as role,
       kind,
       status,
       count(*)::int as n,
       min(requested_at) as oldest,
       sum(amount) as total_amount
from public.approval_requests
where assigned_to is not null
  and status in ('pending', 'approved', 'returned', 'challenged', 'refused', 'failed')
group by restaurant_id, assigned_to, kind, status;

grant select on public.awaiting_me to kb_app;

commit;
