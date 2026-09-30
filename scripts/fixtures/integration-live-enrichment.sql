-- Disposable integration-only read-side evidence for smoke:a2.
-- This is intentionally not a production migration and must never run against
-- live shared books. The runner supplies the cloned tenant as :tenant.

\set ON_ERROR_STOP on

insert into public.vendors (restaurant_id, code, name, primary_category, phone, status)
values (:'tenant'::uuid, 'V-900', 'Integration Credit Vendor', 'GROC', '9000090000', 'active')
on conflict (restaurant_id, code) do update set status = 'active';
select id as second_vendor from public.vendors where restaurant_id = :'tenant'::uuid and code = 'V-900' \gset
select id as rice from public.items where restaurant_id = :'tenant'::uuid and code = 'ING-001' limit 1 \gset
select id as kitchen from public.sections where restaurant_id = :'tenant'::uuid and dept_kind = 'kitchen' order by sort_order limit 1 \gset
select id as sub from public.recipes where restaurant_id = :'tenant'::uuid and kind = 'sub' order by code limit 1 \gset

-- A clean merge pair with history on the closing row. The normal demo items
-- intentionally appear in recipes, so using them would make the merge probe
-- correctly refuse a recipe collision before it reaches the history-moving
-- path.
insert into public.items
  (id, restaurant_id, code, name, category, purchase_unit, stock_unit, status)
values
  ('e9000000-0000-4000-8000-000000000001'::uuid, :'tenant'::uuid, 'AAA-MERGE-FROM', 'Integration merge source', 'GROC', 'kg', 'kg', 'active'),
  ('e9000000-0000-4000-8000-000000000002'::uuid, :'tenant'::uuid, 'AAB-MERGE-TO', 'Integration merge survivor', 'GROC', 'kg', 'kg', 'active')
on conflict (id) do update set status = 'active';
insert into public.items (id, restaurant_id, code, name, category, purchase_unit, stock_unit, status)
values ('e9300000-0000-4000-8000-000000000001'::uuid, :'tenant'::uuid, 'HKP-024', 'Discarded integration item', 'GROC', 'kg', 'kg', 'discarded')
on conflict (id) do update set status = 'discarded';
insert into public.purchases
  (id, restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, entered_by)
values ('e9100000-0000-4000-8000-000000000001'::uuid, :'tenant'::uuid, current_date - 20,
        :'second_vendor'::uuid, 'INT-MERGE-BILL', 4000, 0, 0, 'integration-fixture')
on conflict (id) do nothing;
insert into public.purchase_lines (purchase_id, restaurant_id, item_id, qty, rate)
select 'e9100000-0000-4000-8000-000000000001'::uuid, :'tenant'::uuid,
       'e9000000-0000-4000-8000-000000000001'::uuid, 1, 10
from generate_series(1, 400) g
where not exists (
  select 1 from public.purchase_lines l
  where l.purchase_id = 'e9100000-0000-4000-8000-000000000001'::uuid
);
insert into public.issues (id, restaurant_id, issue_date, section_id, note, entered_by)
select 'e9200000-0000-4000-8000-000000000001'::uuid, :'tenant'::uuid, current_date - 19,
       s.id, 'Integration merge history', 'integration-fixture'
from public.sections s
where s.restaurant_id = :'tenant'::uuid and s.code = 'NI'
on conflict (id) do nothing;
insert into public.issue_lines (issue_id, restaurant_id, item_id, qty, unit_cost)
select 'e9200000-0000-4000-8000-000000000001'::uuid, :'tenant'::uuid,
       'e9000000-0000-4000-8000-000000000001'::uuid, 3, 10
where not exists (
  select 1 from public.issue_lines l
  where l.issue_id = 'e9200000-0000-4000-8000-000000000001'::uuid
);
insert into public.issues (id, restaurant_id, issue_date, section_id, note, entered_by, session)
select 'e9200000-0000-4000-8000-000000000002'::uuid, :'tenant'::uuid, current_date - 19,
       s.id, 'Integration second session', 'integration-fixture', 'Evening'
from public.sections s where s.restaurant_id = :'tenant'::uuid and s.code = 'NI'
on conflict (id) do nothing;
insert into public.issue_lines (issue_id, restaurant_id, item_id, qty, unit_cost)
select 'e9200000-0000-4000-8000-000000000002'::uuid, :'tenant'::uuid, :'rice'::uuid, 1, 10
where not exists (select 1 from public.issue_lines where issue_id = 'e9200000-0000-4000-8000-000000000002'::uuid);

insert into public.vendors (restaurant_id, code, name, primary_category, phone, status)
select :'tenant'::uuid, 'V-9' || lpad(g::text, 2, '0'), 'Integration Vendor ' || g, 'GROC',
       '90000900' || lpad(g::text, 2, '0'), 'active'
from generate_series(1, 10) g
on conflict (restaurant_id, code) do update set status = 'active';
update public.purchases p
set vendor_id = v.id
from public.vendors v
where p.restaurant_id = :'tenant'::uuid and p.bill_no like 'INT-AUG-%'
  and v.restaurant_id = :'tenant'::uuid
  and v.code = 'V-9' || lpad((((substring(p.bill_no from 9)::int - 1) % 10) + 1)::text, 2, '0');

insert into public.purchases
  (restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, entered_by)
select :'tenant'::uuid, current_date - 10, v.id, x.no, 1, 0, 0, 'integration-fixture'
from public.vendors v
cross join (values ('10'),('11'),('13'),('13'),('14')) x(no)
where v.restaurant_id = :'tenant'::uuid and v.code = 'V-001'
  and not exists (select 1 from public.purchases p where p.restaurant_id = :'tenant'::uuid and p.vendor_id = v.id and p.bill_no = x.no);

update public.purchases set goods_total = 150
where restaurant_id = :'tenant'::uuid and bill_no = 'INT-AUG-001';

insert into public.indents (id, restaurant_id, indent_date, section_id, status, note, entered_by, session)
select 'e9400000-0000-4000-8000-000000000001'::uuid, :'tenant'::uuid, current_date - 1,
       s.id, 'open', 'Integration indent', 'integration-fixture', 'Morning'
from public.sections s where s.restaurant_id = :'tenant'::uuid and s.code = 'NI'
on conflict (id) do nothing;
insert into public.indent_lines (id, indent_id, item_id, qty_requested, restaurant_id)
select 'e9500000-0000-4000-8000-000000000001'::uuid, 'e9400000-0000-4000-8000-000000000001'::uuid,
       :'rice'::uuid, 5, :'tenant'::uuid
where not exists (select 1 from public.indent_lines where indent_id = 'e9400000-0000-4000-8000-000000000001'::uuid);

-- Enough dates/vendors for pagination, range totals and the 80% boundary.
with wanted as (
  select g, date '2020-01-01' + ((g - 1) % 28) as bill_date
  from generate_series(1, 301) g
), added as (
  insert into public.purchases
    (restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, entered_by)
  select :'tenant'::uuid, w.bill_date, v.id, 'INT-BULK-' || lpad(w.g::text, 3, '0'), 10, 0, 0, 'integration-fixture'
  from wanted w
  join public.vendors v on v.restaurant_id = :'tenant'::uuid and v.code = case when w.g % 5 = 0 then 'V-900' else 'V-002' end
  where not exists (
    select 1 from public.purchases p
    where p.restaurant_id = :'tenant'::uuid and p.bill_no = 'INT-BULK-' || lpad(w.g::text, 3, '0')
  )
  returning id
)
insert into public.purchase_lines (purchase_id, restaurant_id, item_id, qty, rate)
select a.id, :'tenant'::uuid, :'rice'::uuid, 1, 10 from added a;

insert into public.starter_library (id, name, category, purchase_unit)
values (910001, 'Integration starter item', 'GROC', 'kg'),
       (910002, 'Integration vegetable', 'VEG', 'kg')
on conflict (id) do nothing;

with wanted as (
  select g, date '2026-08-01' + ((g - 1) % 20) as bill_date
  from generate_series(1, 20) g
), added as (
  insert into public.purchases
    (restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, entered_by)
  select :'tenant'::uuid, w.bill_date, v.id, 'INT-AUG-' || lpad(w.g::text, 3, '0'), 100, 0, 0, 'integration-fixture'
  from wanted w join public.vendors v on v.restaurant_id = :'tenant'::uuid and v.code = 'V-002'
  where not exists (select 1 from public.purchases p where p.restaurant_id = :'tenant'::uuid and p.bill_no = 'INT-AUG-' || lpad(w.g::text, 3, '0'))
  returning id
)
insert into public.purchase_lines (purchase_id, restaurant_id, item_id, qty, rate)
select id, :'tenant'::uuid, :'rice'::uuid, 10, 10 from added;

-- The refill gate needs a real last set, not a current-day demo row.
update public.productions
set prod_date = date '2020-01-02'
where restaurant_id = :'tenant'::uuid;
insert into public.productions
  (restaurant_id, section_id, prod_date, recipe_id, output_qty, unit_cost, entered_by)
select :'tenant'::uuid, :'kitchen'::uuid, date '2020-01-03', :'sub'::uuid, 7.5,
       rc.cost_per_output_unit, 'integration-fixture'
from public.recipe_costs rc
where rc.recipe_id = :'sub'::uuid
  and not exists (
    select 1 from public.productions p
    where p.restaurant_id = :'tenant'::uuid and p.prod_date = date '2020-01-03'
      and p.section_id = :'kitchen'::uuid and p.recipe_id = :'sub'::uuid
  );

-- Both receivable modes must be visible to the cashier gate.
with f as (
  select id from public.pos_fetches
  where restaurant_id = :'tenant'::uuid order by business_date desc, id limit 1
)
insert into public.pos_orders
  (fetch_id, restaurant_id, business_date, pos_order_id, channel, order_type,
   payment_mode, covers, status_raw, status_class, subtotal, tax, order_total, order_time)
select f.id, :'tenant'::uuid, current_date - 1, x.order_id, 'Counter', 'Dine-in',
       x.mode, 1, 'Success', 'revenue', x.total, 0, x.total, now()
from f cross join (values ('INT-DUE-001','Due Payment',450::numeric), ('INT-PART-001','Part Payment',650::numeric)) x(order_id,mode,total)
where not exists (select 1 from public.pos_orders o where o.restaurant_id = :'tenant'::uuid and o.pos_order_id = x.order_id);

-- A credit is meaningful only if it is overpaid, so ageing has both sides.
insert into public.payments (restaurant_id, paid_date, vendor_id, amount, mode, note, entered_by)
select :'tenant'::uuid, current_date, v.id, 99999, 'bank', 'integration overpayment evidence', 'integration-fixture'
from public.vendors v
where v.restaurant_id = :'tenant'::uuid and v.code = 'V-900'
  and not exists (
    select 1 from public.payments p
    where p.restaurant_id = :'tenant'::uuid and p.note = 'integration overpayment evidence'
  );
