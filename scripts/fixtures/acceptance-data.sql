-- Disposable acceptance data for a local PostgreSQL run.
-- Never run this against shared or production Supabase. The smoke suite keeps
-- its live tenant immutable; this fixture is intentionally local-only and
-- provides the historical evidence needed by read-side gates.

\set tenant '11111111-1111-4111-8111-111111111111'
\set vendor '51111111-1111-4111-8111-111111111111'
\set rice '41111111-1111-4111-8111-111111111111'
\set paneer '41111111-1111-4111-8111-111111111112'
\set water '41111111-1111-4111-8111-111111111113'
\set kitchen '21111111-1111-4111-8111-111111111112'

insert into sections (id, restaurant_id, code, name, sort_order, dept_group, codes_dishes, dept_kind, receives_stock)
values ('b2111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111112', 'CH', 'Probe Chinese', 3, 'Kitchen', true, 'kitchen', true)
on conflict (id) do nothing;
insert into units (code, name) values ('portion', 'Portion') on conflict (code) do nothing;

-- Local-only identity used by smoke-tenancy. This is a fixture hash, never a
-- production credential; the real rollout must provision its own owner.
insert into app_users (id, restaurant_id, username, display_name, role, password_hash, status)
values (
  'c1111111-1111-4111-8111-111111111111',
  :'tenant'::uuid,
  'rajeshanne',
  'Acceptance Owner',
  'owner',
  '$2b$10$wc437IcKz3NIZgdBbqZYcud8GFYhsNoXyqCMUc1DSrotA50d2.gkm',
  'active'
)
on conflict (id) do nothing;

-- Canonical baseline used by the older operational smoke suites. Keep these
-- names/codes stable so a fresh disposable database can exercise the same
-- paths without relying on an undocumented historical seed.
insert into categories (code, name, kind, sort_order, status)
values
 ('VEG', 'Vegetables', 'ingredient', 20, 'active'),
 ('NONVEG', 'Non-vegetarian', 'ingredient', 21, 'active')
on conflict (code) do nothing;
insert into starter_library (id, name, category, purchase_unit)
values
 (900002, 'Onions', 'VEG', 'kg'),
 (900003, 'Tomatoes', 'VEG', 'kg')
on conflict (id) do nothing;
insert into items (id, restaurant_id, code, name, category, purchase_unit, stock_unit, status, tracks_expiry)
values
 ('e1111111-1111-4111-8111-111111111111', :'tenant'::uuid, 'PLT-001', 'Chicken boneless', 'NONVEG', 'kg', 'kg', 'active', false),
 ('e1111111-1111-4111-8111-111111111112', :'tenant'::uuid, 'PLT-002', 'Chicken curry cut', 'NONVEG', 'kg', 'kg', 'active', false)
on conflict (id) do nothing;
insert into purchases (id, restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, entered_by)
values ('e2111111-1111-4111-8111-111111111111', :'tenant'::uuid, '2026-08-19', :'vendor'::uuid, 'ACC-BASE-001', 8100, 0, 0, 'fixture')
on conflict (id) do nothing;
insert into purchase_lines (id, purchase_id, restaurant_id, item_id, qty, rate, gst_amount, transport_alloc)
values
 ('e3111111-1111-4111-8111-111111111111', 'e2111111-1111-4111-8111-111111111111', :'tenant'::uuid, 'e1111111-1111-4111-8111-111111111111', 20, 305, 0, 0),
 ('e3111111-1111-4111-8111-111111111112', 'e2111111-1111-4111-8111-111111111111', :'tenant'::uuid, 'e1111111-1111-4111-8111-111111111112', 10, 200, 0, 0)
on conflict (id) do nothing;

insert into accounting_accounts (restaurant_id, code, name, account_type)
values
  (:'tenant'::uuid,'REV','Sales revenue','revenue'),
  (:'tenant'::uuid,'INV','Inventory asset','asset'),
  (:'tenant'::uuid,'FOOD','Food cost','expense'),
  (:'tenant'::uuid,'EXP','Operating expense','expense'),
  (:'tenant'::uuid,'LAB','Labour expense','expense'),
  (:'tenant'::uuid,'AP','Vendor payable','liability'),
  (:'tenant'::uuid,'AR','POS receivable','asset'),
  (:'tenant'::uuid,'CASH','POS cash','asset'),
  (:'tenant'::uuid,'UPI','POS UPI','asset'),
  (:'tenant'::uuid,'CARD','POS card','asset'),
  (:'tenant'::uuid,'DEL','POS delivery','asset'),
  (:'tenant'::uuid,'OTHER','POS other','asset'),
  (:'tenant'::uuid,'TAX','Tax payable','liability'),
  (:'tenant'::uuid,'FUND','Staff fund','liability'),
  (:'tenant'::uuid,'ADV','Staff advance','asset'),
  (:'tenant'::uuid,'DED','Payroll deductions','liability'),
  (:'tenant'::uuid,'OI','Other income','revenue')
on conflict (restaurant_id, code) do nothing;

insert into accounting_posting_mappings (restaurant_id, mapping_key, account_id, updated_by)
select :'tenant'::uuid, k.key, a.id, 'acceptance-fixture'
from (values
  ('vendor_payable','AP'),('owner_payable','AP'),('sales_revenue','REV'),
  ('other_income_revenue','OI'),('inventory_asset','INV'),('input_tax_asset','INV'),
  ('food_cost','FOOD'),('operating_expense','EXP'),('labour_expense','LAB'),
  ('withholding_payable','DED'),('staff_advance_asset','ADV'),
  ('payroll_deduction_payable','DED'),('tax_payable','TAX'),('staff_fund','FUND'),
  ('pos_cash_asset','CASH'),('pos_upi_asset','UPI'),('pos_card_asset','CARD'),
  ('pos_delivery_asset','DEL'),('pos_receivable_asset','AR'),('pos_other_asset','OTHER')
) k(key, code)
join accounting_accounts a on a.restaurant_id = :'tenant'::uuid and a.code = k.code
on conflict (restaurant_id, mapping_key) do nothing;

insert into purchases (id, restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, entered_by)
values ('71111111-1111-4111-8111-111111111111', :'tenant'::uuid, '2026-08-20', :'vendor'::uuid, 'ACC-BILL-001', 1000, 0, 0, 'fixture')
on conflict (id) do nothing;
insert into purchase_lines (purchase_id, restaurant_id, item_id, qty, rate, gst_amount, transport_alloc)
values
 ('71111111-1111-4111-8111-111111111111', :'tenant'::uuid, :'rice'::uuid, 100, 8, 0, 0),
 ('71111111-1111-4111-8111-111111111111', :'tenant'::uuid, :'paneer'::uuid, 20, 50, 0, 0)
on conflict (id) do nothing;

insert into issues (id, restaurant_id, issue_date, section_id, note, entered_by)
values ('81111111-1111-4111-8111-111111111111', :'tenant'::uuid, '2026-08-21', :'kitchen'::uuid, 'Acceptance issue', 'fixture')
on conflict (id) do nothing;
insert into issue_lines (issue_id, restaurant_id, item_id, qty, unit_cost)
values
 ('81111111-1111-4111-8111-111111111111', :'tenant'::uuid, :'rice'::uuid, 5, 8),
 ('81111111-1111-4111-8111-111111111111', :'tenant'::uuid, :'paneer'::uuid, 2, 50)
on conflict (id) do nothing;

insert into pos_fetches (id, restaurant_id, business_date, order_count, note)
values ('91111111-1111-4111-8111-111111111111', :'tenant'::uuid, '2026-08-22', 3, 'Acceptance POS generation')
on conflict (id) do nothing;
insert into pos_orders (id, fetch_id, restaurant_id, business_date, pos_order_id, channel, payment_mode, covers, status_raw, status_class, subtotal, order_total)
values
 ('a1111111-1111-4111-8111-111111111111','91111111-1111-4111-8111-111111111111',:'tenant'::uuid,'2026-08-22','ACC-001','Counter','Cash',2,'Success','revenue',500,500),
 ('a1111111-1111-4111-8111-111111111112','91111111-1111-4111-8111-111111111111',:'tenant'::uuid,'2026-08-22','ACC-002','Counter','Due Payment',1,'Success','revenue',250,250),
 ('a1111111-1111-4111-8111-111111111113','91111111-1111-4111-8111-111111111111',:'tenant'::uuid,'2026-08-22','ACC-003','Delivery','UPI',2,'Success','revenue',750,750)
on conflict (id) do nothing;
insert into pos_lines (order_id, restaurant_id, pos_item_id, item_name, qty, amount)
values
 ('a1111111-1111-4111-8111-111111111111',:'tenant'::uuid,'RICE','Rice',2,300),
 ('a1111111-1111-4111-8111-111111111112',:'tenant'::uuid,'WATER','Bottled Water',5,250),
 ('a1111111-1111-4111-8111-111111111113',:'tenant'::uuid,'PANEER','Paneer',3,750)
on conflict (id) do nothing;
insert into pos_item_map (restaurant_id, pos_item_id, item_name, item_id, section_id)
values
 (:'tenant'::uuid,'RICE','Rice',:'rice'::uuid,:'kitchen'::uuid),
 (:'tenant'::uuid,'WATER','Bottled Water',:'water'::uuid,:'kitchen'::uuid),
 (:'tenant'::uuid,'PANEER','Paneer',:'paneer'::uuid,:'kitchen'::uuid)
on conflict do nothing;

insert into day_closes (restaurant_id, close_date, opening_cash, extra_cash_in, handed_over, cash_counted, entered_by, seq)
select :'tenant'::uuid, '2026-08-22', 0, 0, 0, 500, 'fixture', 1
where not exists (select 1 from day_closes where restaurant_id = :'tenant'::uuid and close_date = '2026-08-22');

-- Keep the list/register and boundary tests meaningful: a real fixture must
-- exceed the historical 300-row failure threshold and include two vendors.
insert into vendors (id, restaurant_id, code, name, primary_category, phone)
values ('51111111-1111-4111-8111-111111111114', :'tenant'::uuid, 'V-002', 'Second Acceptance Vendor', 'GROC', '9876543211')
on conflict (id) do nothing;
with new_bills as (
  insert into purchases (restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, entered_by)
  select :'tenant'::uuid, date '2026-08-01' + (g % 28), :'vendor'::uuid,
         'ACC-BULK-' || lpad(g::text, 3, '0'), 10, 0, 0, 'fixture'
  from generate_series(1, 301) g
  where not exists (select 1 from purchases where restaurant_id = :'tenant'::uuid and bill_no = 'ACC-BULK-001')
  returning id
)
insert into purchase_lines (purchase_id, restaurant_id, item_id, qty, rate)
select id, :'tenant'::uuid, :'rice'::uuid, 1, 10 from new_bills;
insert into purchases (restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, entered_by)
select :'tenant'::uuid, '2026-08-23', '51111111-1111-4111-8111-111111111114'::uuid, 'ACC-V2-001', 120, 0, 0, 'fixture'
where not exists (select 1 from purchases where restaurant_id = :'tenant'::uuid and bill_no = 'ACC-V2-001');
insert into purchase_lines (purchase_id, restaurant_id, item_id, qty, rate)
select p.id, :'tenant'::uuid, :'rice'::uuid, 10, 12
from purchases p
where p.restaurant_id = :'tenant'::uuid and p.bill_no = 'ACC-V2-001'
  and not exists (select 1 from purchase_lines l where l.purchase_id = p.id);

insert into starter_library (id, name, category, purchase_unit)
values (900001, 'Acceptance starter item', 'GROC', 'kg')
on conflict (id) do nothing;
insert into items (restaurant_id, code, name, category, purchase_unit, status)
values (:'tenant'::uuid, 'HKP-024', 'Discarded acceptance item', 'GROC', 'kg', 'discarded')
on conflict (restaurant_id, code) do nothing;
insert into purchase_orders (id, restaurant_id, doc_no, vendor_id, po_date, status, entered_by)
values ('a3111111-1111-4111-8111-111111111111', :'tenant'::uuid, 'PO-ACC-001', :'vendor'::uuid, '2026-08-24', 'draft', 'fixture')
on conflict (id) do nothing;
insert into purchase_order_lines (restaurant_id, purchase_order_id, item_id, qty, rate)
select :'tenant'::uuid, 'a3111111-1111-4111-8111-111111111111'::uuid, :'rice'::uuid, 16, 10
where not exists (select 1 from purchase_order_lines where purchase_order_id = 'a3111111-1111-4111-8111-111111111111');
insert into issues (id, restaurant_id, issue_date, section_id, note, entered_by, session)
values ('a4111111-1111-4111-8111-111111111111', :'tenant'::uuid, '2026-08-21', :'kitchen'::uuid, 'Acceptance evening issue', 'fixture', 'Evening')
on conflict (id) do nothing;
insert into issue_lines (issue_id, restaurant_id, item_id, qty, unit_cost)
values ('a4111111-1111-4111-8111-111111111111', :'tenant'::uuid, :'rice'::uuid, 3, 10)
on conflict (id) do nothing;

with new_vendors as (
  insert into vendors (restaurant_id, code, name, primary_category, phone)
  select :'tenant'::uuid, 'V-' || lpad(g::text, 3, '0'), 'Acceptance Vendor ' || g,
         'GROC', '90000000' || lpad(g::text, 2, '0')
  from generate_series(3, 12) g
  where not exists (select 1 from vendors where restaurant_id = :'tenant'::uuid and code = 'V-003')
  returning id, code
), new_bills as (
  insert into purchases (restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, entered_by)
  select :'tenant'::uuid, '2026-08-24', id, 'ACC-' || code, 20, 0, 0, 'fixture'
  from new_vendors returning id
)
insert into purchase_lines (purchase_id, restaurant_id, item_id, qty, rate)
select id, :'tenant'::uuid, :'water'::uuid, 2, 10 from new_bills;

-- Give the read-side gates real recipe history: one costed preparation and two
-- costed dishes in different sections/orders. These are disposable examples, not a
-- restaurant's menu.
insert into recipes (id, restaurant_id, code, name, kind, section_id, output_qty, output_unit, selling_price, status, portions, portion_size, portion_unit)
values
 ('c1111111-1111-4111-8111-111111111111', :'tenant'::uuid, 'ACC-SUB-001', 'Acceptance gravy base', 'sub', :'kitchen'::uuid, 10, 'kg', null, 'active', null, null, null),
 ('c1111111-1111-4111-8111-111111111112', :'tenant'::uuid, 'ACC-DISH-001', 'Acceptance paneer bowl', 'dish', :'kitchen'::uuid, 1, 'portion', 180, 'active', 1, 1, 'portion')
on conflict (id) do nothing;
insert into recipe_lines (id, recipe_id, restaurant_id, component_item_id, qty, yield_pct, note)
values
 ('c2111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', :'tenant'::uuid, :'rice'::uuid, 2, 100, 'fixture component'),
 ('c2111111-1111-4111-8111-111111111112', 'c1111111-1111-4111-8111-111111111112', :'tenant'::uuid, :'paneer'::uuid, 1, 100, 'fixture component')
on conflict (id) do nothing;
insert into recipes (id, restaurant_id, code, name, kind, section_id, output_qty, output_unit, selling_price, status, portions, portion_size, portion_unit)
select 'c1111111-1111-4111-8111-111111111113', :'tenant'::uuid, 'ACC-DISH-002', 'Acceptance rice bowl', 'dish', s.id, 1, 'portion', 120, 'active', 1, 1, 'portion'
from sections s
where s.restaurant_id = :'tenant'::uuid and s.code = 'BK'
on conflict (id) do nothing;
insert into recipe_lines (id, recipe_id, restaurant_id, component_item_id, qty, yield_pct, note)
values ('c2111111-1111-4111-8111-111111111113', 'c1111111-1111-4111-8111-111111111113', :'tenant'::uuid, :'rice'::uuid, 10, 100, 'fixture component')
on conflict (id) do nothing;

-- Ensure time-aware POS and lot-ledger gates have evidence after the fixture
-- is loaded (the migration may have run before these disposable rows existed).
update pos_orders
set order_time = case pos_order_id when 'ACC-001' then '2026-08-22 23:45:00'::timestamp when 'ACC-002' then '2026-08-22 00:30:00'::timestamp else '2026-08-22 12:00:00'::timestamp end
where restaurant_id = :'tenant'::uuid and pos_order_id in ('ACC-001', 'ACC-002', 'ACC-003');
insert into stock_lots (restaurant_id, item_id, lot_code, received_date, initial_qty, unit_cost, location_id)
select s.restaurant_id, s.item_id, 'LEGACY-' || s.item_id::text, current_date,
       s.on_hand_qty, coalesce(s.on_hand_value / nullif(s.on_hand_qty, 0), 0), i.storage_location_id
from stock_on_hand s
join items i on i.restaurant_id = s.restaurant_id and i.id = s.item_id
where s.restaurant_id = :'tenant'::uuid and s.on_hand_qty > 0
  and not exists (select 1 from stock_lots l where l.restaurant_id = s.restaurant_id and l.item_id = s.item_id)
on conflict (restaurant_id, item_id, lot_code) do nothing;

-- A reversal pair makes the return screen prove that voided bills are not
-- offered as return sources. The pair is evidence only; it creates no stock
-- because this fixture is loaded after the lot migration.
insert into purchases (id, restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, entered_by)
values ('d1111111-1111-4111-8111-111111111111', :'tenant'::uuid, '2026-08-25', :'vendor'::uuid, 'ACC-VOID-001', 50, 0, 0, 'fixture')
on conflict (id) do nothing;
insert into purchases (id, restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, reverses_id, entered_by)
values ('d1111111-1111-4111-8111-111111111112', :'tenant'::uuid, '2026-08-25', :'vendor'::uuid, 'ACC-VOID-001-R', -50, 0, 0, 'd1111111-1111-4111-8111-111111111111', 'fixture')
on conflict (id) do nothing;

-- Fully settle the second vendor so the owed/all parties filter has both
-- branches to display. This is fixture evidence, not a production posting.
insert into payments (id, restaurant_id, paid_date, vendor_id, amount, mode, note, entered_by)
values ('d2111111-1111-4111-8111-111111111111', :'tenant'::uuid, '2026-08-26', '51111111-1111-4111-8111-111111111114'::uuid, 120, 'cash', 'acceptance fixture settlement', 'fixture')
on conflict (id) do nothing;
