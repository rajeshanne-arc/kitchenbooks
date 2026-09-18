-- Configurable purchase-order approval foundation.
--
-- This migration only adds durable state and tenant policy. The application
-- must deploy the matching state-machine code in the same release before the
-- setting is enabled for a restaurant.

begin;

alter table public.purchase_orders
  add column if not exists approval_status text not null default 'not_required'
    check (approval_status in ('not_required', 'pending', 'approved', 'refused', 'cancelled')),
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approval_decided_at timestamptz,
  add column if not exists approval_decided_by text;

create table if not exists public.purchase_order_approvals (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  purchase_order_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'refused', 'cancelled')),
  amount numeric(14,2) not null check (amount >= 0),
  reason text not null check (length(btrim(reason)) > 0),
  requested_by text,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  unique (restaurant_id, id),
  foreign key (restaurant_id, purchase_order_id)
    references public.purchase_orders (restaurant_id, id)
);

create unique index if not exists purchase_order_approvals_one_pending
  on public.purchase_order_approvals (restaurant_id, purchase_order_id)
  where status = 'pending';

alter table public.purchase_order_approvals enable row level security;
alter table public.purchase_order_approvals force row level security;
drop policy if exists tenant_isolation on public.purchase_order_approvals;
create policy tenant_isolation on public.purchase_order_approvals
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

grant select, insert, update on public.purchase_order_approvals to kb_app;

insert into public.settings (restaurant_id, key, value)
select r.id, 'purchase_approval_mode', 'none'
from public.restaurants r
where not exists (
  select 1 from public.settings s
  where s.restaurant_id = r.id and s.key = 'purchase_approval_mode'
);

insert into public.settings (restaurant_id, key, value)
select r.id, 'purchase_approval_threshold', '0.00'
from public.restaurants r
where not exists (
  select 1 from public.settings s
  where s.restaurant_id = r.id and s.key = 'purchase_approval_threshold'
);

commit;

-- Rollout order:
-- 1. Deploy the matching server state machine and owner queue.
-- 2. Verify pending/approved/refused transitions on a non-production tenant.
-- 3. Enable threshold mode per restaurant only after owner sign-off.
