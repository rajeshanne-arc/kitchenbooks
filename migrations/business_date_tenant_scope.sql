-- business_date_tenant_scope
--
-- The business-date helper has no restaurant argument because callers announce
-- the tenant on the transaction. Make that boundary explicit in the function
-- itself as well: otherwise an owner connection that can see more than one
-- tenant produces a multi-row scalar-subquery error instead of a date.
-- `true` keeps the no-session diagnostic fallback deterministic (UTC/no
-- cutover); application transactions always announce app.restaurant_id.

create or replace function public.business_date(p_at timestamptz default now())
returns date
language sql
stable
as $$
  select (
    (p_at at time zone coalesce(
      (select value
         from settings
        where restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid
          and key = 'timezone'),
      'UTC'))
    - coalesce(
      (select value
         from settings
        where restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid
          and key = 'business_day_start'),
      '00:00')::interval
  )::date
$$;
