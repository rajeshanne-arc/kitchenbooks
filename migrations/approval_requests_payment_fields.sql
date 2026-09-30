-- Payment-request fields and employee-advance settlement link.
--
-- These fields are deliberately separate from approval_requests_payment_kind:
-- the kind migration only enables the payment kind, while this migration adds
-- the data and database guards used by the payment-routing workflow.

begin;

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

alter table approval_requests
  add column if not exists amount numeric,
  add column if not exists suggested_mode text,
  add column if not exists routed_mode text,
  add column if not exists bills_from date,
  add column if not exists bills_to date,
  add column if not exists routed_account_id uuid,
  add column if not exists assigned_to text;

alter table approval_requests
  drop constraint if exists approval_requests_amount_check;
alter table approval_requests
  add constraint approval_requests_amount_check
  check (amount is null or amount > 0);

alter table approval_requests
  drop constraint if exists approval_requests_bill_range_check;
alter table approval_requests
  add constraint approval_requests_bill_range_check
  check (
    (bills_from is null and bills_to is null)
    or (bills_from is not null and bills_to is not null and bills_from <= bills_to)
  );

alter table approval_requests
  drop constraint if exists approval_requests_routed_account_fkey;
create unique index if not exists approval_requests_tenant_uq
  on approval_requests (restaurant_id, id);
alter table approval_requests
  add constraint approval_requests_routed_account_fkey
  foreign key (restaurant_id, routed_account_id)
  references money_accounts (restaurant_id, id);

alter table staff_advances
  add column if not exists approved_request_id uuid;

alter table staff_advances
  drop constraint if exists staff_advances_approved_request_fkey;
alter table staff_advances
  add constraint staff_advances_approved_request_fkey
  foreign key (restaurant_id, approved_request_id)
  references approval_requests (restaurant_id, id);

create unique index if not exists staff_advances_one_per_request
  on staff_advances (restaurant_id, approved_request_id)
  where approved_request_id is not null;

create index if not exists approval_requests_assigned_to
  on approval_requests (restaurant_id, assigned_to, status);
create index if not exists approval_requests_routed_account
  on approval_requests (restaurant_id, routed_account_id);

alter table approval_requests
  drop constraint if exists approval_requests_no_overlapping_open_ranges;
alter table approval_requests
  add constraint approval_requests_no_overlapping_open_ranges
  exclude using gist (
    restaurant_id with =,
    entity_id with =,
    daterange(bills_from, bills_to, '[]') with &&
  )
  where (
    kind = 'payment'
    and entity_type = 'vendor'
    and status in ('pending', 'approved')
    and bills_from is not null
    and bills_to is not null
  );

commit;
