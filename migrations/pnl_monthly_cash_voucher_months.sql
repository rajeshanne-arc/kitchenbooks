-- Ensure drawer-paid goods and casual labour remain visible even when a month
-- contains no other source row. The existing P&L CTEs already aggregate these
-- vouchers; the missing part was the month spine, which meant a voucher-only
-- month produced no pnl_monthly row at all.
begin;

create or replace view public.pnl_monthly as
with mth as (
  select restaurant_id, date_trunc('month', business_date)::date as m
  from sales_by_day
  union
  select restaurant_id, month from purchases_by_month
  union
  select restaurant_id, date_trunc('month', expense_date)::date from expenses
  union
  select restaurant_id, month from labour_cost_by_section
  union
  select restaurant_id, date_trunc('month', voucher_date)::date
  from cash_vouchers
  where is_stock_purchase or is_casual_labour
), rev as (
  select restaurant_id, date_trunc('month', business_date)::date as m,
         sum(revenue) as v, sum(orders) as o, sum(covers) as cv
  from sales_by_day
  group by restaurant_id, date_trunc('month', business_date)::date
), ob as (
  select restaurant_id, date_trunc('month', order_date)::date as m, sum(amount) as v
  from off_book_orders group by restaurant_id, date_trunc('month', order_date)::date
), oi as (
  select restaurant_id, date_trunc('month', income_date)::date as m, sum(amount) as v
  from other_income group by restaurant_id, date_trunc('month', income_date)::date
), pur as (
  select x.restaurant_id, x.m, sum(x.v) as v
  from (
    select restaurant_id, month as m, purchases as v from purchases_by_month
    union all
    select restaurant_id, date_trunc('month', voucher_date)::date, amount
    from cash_vouchers where is_stock_purchase
  ) x group by x.restaurant_id, x.m
), ss as (
  select restaurant_id, month as m, closing_value as v from store_stock_by_month
), ks as (
  select restaurant_id, month as m, closing_value as v from kitchen_stock_by_month
), wag as (
  select restaurant_id, month as m, sum(labour_cost) as v
  from labour_cost_by_section group by restaurant_id, month
), con as (
  select restaurant_id, date_trunc('month', bill_date)::date as m, sum(amount) as v
  from contract_bills group by restaurant_id, date_trunc('month', bill_date)::date
), cas as (
  select x.restaurant_id, x.m, sum(x.v) as v
  from (
    select restaurant_id, date_trunc('month', work_date)::date as m, amount as v from casual_labour
    union all
    select restaurant_id, date_trunc('month', voucher_date)::date, amount
    from cash_vouchers where is_casual_labour
  ) x group by x.restaurant_id, x.m
), exc as (
  select e.restaurant_id, date_trunc('month', e.expense_date)::date as m,
         sum(e.amount) filter (where coalesce(k.kind, 'controllable') = 'controllable') as ctrl,
         sum(e.amount) filter (where k.kind = 'occupancy') as occ
  from expenses e left join expense_category_kinds k
    on k.restaurant_id = e.restaurant_id and k.category = e.category
  group by e.restaurant_id, date_trunc('month', e.expense_date)::date
), sf as (
  select restaurant_id, month as m, sum(consumed_total) as v
  from section_food_cost where section_code = 'SF'
  group by restaurant_id, month
)
select mth.restaurant_id, mth.m as month,
  coalesce(rev.v, 0) as food_beverage,
  coalesce(ob.v, 0) as off_book,
  coalesce(rev.v, 0) + coalesce(ob.v, 0) as net_sales,
  lag(coalesce(ss.v, 0)) over (partition by mth.restaurant_id order by mth.m) as opening_store,
  lag(coalesce(ks.v, 0)) over (partition by mth.restaurant_id order by mth.m) as opening_kitchen,
  coalesce(pur.v, 0) as purchases,
  coalesce(ss.v, 0) as closing_store,
  coalesce(ks.v, 0) as closing_kitchen,
  coalesce(lag(coalesce(ss.v, 0)) over (partition by mth.restaurant_id order by mth.m), 0)
    + coalesce(lag(coalesce(ks.v, 0)) over (partition by mth.restaurant_id order by mth.m), 0)
    + coalesce(pur.v, 0) - coalesce(ss.v, 0) - coalesce(ks.v, 0) as cogs,
  coalesce(sf.v, 0) as staff_food,
  coalesce(wag.v, 0) as wages,
  coalesce(con.v, 0) as contract_vendors,
  coalesce(cas.v, 0) as casual_labour,
  coalesce(wag.v, 0) + coalesce(con.v, 0) + coalesce(cas.v, 0) as total_labour,
  coalesce(exc.ctrl, 0) as controllable,
  coalesce(exc.occ, 0) as occupancy,
  coalesce(exc.ctrl, 0) + coalesce(exc.occ, 0) as total_expenses,
  coalesce(oi.v, 0) as other_income,
  coalesce(rev.o, 0) as orders,
  coalesce(rev.cv, 0) as covers
from mth
left join rev on rev.restaurant_id = mth.restaurant_id and rev.m = mth.m
left join ob on ob.restaurant_id = mth.restaurant_id and ob.m = mth.m
left join oi on oi.restaurant_id = mth.restaurant_id and oi.m = mth.m
left join pur on pur.restaurant_id = mth.restaurant_id and pur.m = mth.m
left join ss on ss.restaurant_id = mth.restaurant_id and ss.m = mth.m
left join ks on ks.restaurant_id = mth.restaurant_id and ks.m = mth.m
left join wag on wag.restaurant_id = mth.restaurant_id and wag.m = mth.m
left join con on con.restaurant_id = mth.restaurant_id and con.m = mth.m
left join cas on cas.restaurant_id = mth.restaurant_id and cas.m = mth.m
left join exc on exc.restaurant_id = mth.restaurant_id and exc.m = mth.m
left join sf on sf.restaurant_id = mth.restaurant_id and sf.m = mth.m;

-- CREATE OR REPLACE VIEW resets view options on PostgreSQL. This migration is
-- listed after the security-invoker migration may have run, so restore the
-- tenant backstop at the replacement site.
alter view public.pnl_monthly set (security_invoker = on);

commit;
