-- KitchenBooks demo environment.
--
-- These functions are intentionally separate from restaurant business data.
-- The application endpoint supplies the configured demo tenant id and secret;
-- the function itself refuses to operate on a tenant unless that tenant has
-- the explicit demo_reset_enabled setting.

begin;

create or replace function public.reset_demo_tenant(p_restaurant_id uuid, p_owner_username text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  r record;
  owner_id uuid;
  progress boolean;
  remaining text;
begin
  if not exists (
    select 1 from public.restaurants where id = p_restaurant_id
  ) then
    raise exception 'demo tenant does not exist';
  end if;
  if not exists (
    select 1 from public.settings
    where restaurant_id = p_restaurant_id
      and key = 'demo_reset_enabled' and value = 'true'
  ) then
    raise exception 'refusing to reset a tenant without demo_reset_enabled';
  end if;

  select id into owner_id
  from public.app_users
  where restaurant_id = p_restaurant_id
    and lower(username) = lower(p_owner_username)
    and role = 'owner' and status = 'active'
  limit 1;
  if owner_id is null then
    raise exception 'demo owner account is missing';
  end if;

  create temporary table demo_reset_tables(table_name text primary key) on commit drop;
  insert into demo_reset_tables(table_name)
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'restaurant_id' and not a.attisdropped
    )
    and c.relname not in ('restaurants');

  -- Delete children before parents. The retry loop uses the database's FK
  -- graph rather than maintaining a fragile hand-written table order.
  loop
    progress := false;
    for r in select table_name from demo_reset_tables order by table_name loop
      begin
        if r.table_name = 'app_users' then
          execute format('delete from public.%I where restaurant_id = $1 and id <> $2', r.table_name)
            using p_restaurant_id, owner_id;
        elsif r.table_name = 'restaurant_memberships' then
          execute format('delete from public.%I where restaurant_id = $1 and account_id <> $2', r.table_name)
            using p_restaurant_id, owner_id;
        else
          execute format('delete from public.%I where restaurant_id = $1', r.table_name)
            using p_restaurant_id;
        end if;
        delete from demo_reset_tables where table_name = r.table_name;
        progress := true;
      exception when foreign_key_violation then
        -- A parent is retained for a later pass while its child remains.
        null;
      end;
    end loop;
    exit when not exists (select 1 from demo_reset_tables) or not progress;
  end loop;

  if exists (select 1 from demo_reset_tables) then
    select string_agg(table_name, ', ' order by table_name) into remaining from demo_reset_tables;
    raise exception 'demo reset could not clear tenant tables: %', remaining;
  end if;

  insert into public.settings(restaurant_id, key, value)
  values (p_restaurant_id, 'demo_reset_enabled', 'true')
  on conflict (restaurant_id, key) do update set value = 'true';

  -- Preserve only the owner identity; the seed recreates the owner membership.
  delete from public.restaurant_memberships where restaurant_id = p_restaurant_id;
  insert into public.restaurant_memberships(restaurant_id, account_id, role, status)
  values (p_restaurant_id, owner_id, 'owner', 'active');
end;
$$;

create or replace function public.seed_demo_tenant(p_restaurant_id uuid, p_owner_username text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  owner_id uuid;
  manager_id uuid;
  chef_id uuid;
  store_id uuid;
  cashier_id uuid;
  accountant_id uuid;
  cold_id uuid := 'd0000000-0000-4000-8000-000000000001';
  dry_id uuid := 'd0000000-0000-4000-8000-000000000002';
  kitchen_id uuid := 'd0000000-0000-4000-8000-000000000003';
  service_id uuid := 'd0000000-0000-4000-8000-000000000004';
  rice_id uuid := 'd1000000-0000-4000-8000-000000000001';
  paneer_id uuid := 'd1000000-0000-4000-8000-000000000002';
  onion_id uuid := 'd1000000-0000-4000-8000-000000000003';
  tomato_id uuid := 'd1000000-0000-4000-8000-000000000004';
  oil_id uuid := 'd1000000-0000-4000-8000-000000000005';
  vendor_id uuid := 'd2000000-0000-4000-8000-000000000001';
  vendor2_id uuid := 'd2000000-0000-4000-8000-000000000002';
  rice_bowl_id uuid := 'd3000000-0000-4000-8000-000000000001';
  paneer_bowl_id uuid := 'd3000000-0000-4000-8000-000000000002';
  gravy_id uuid := 'd3000000-0000-4000-8000-000000000003';
  purchase_id uuid := 'd4000000-0000-4000-8000-000000000001';
  issue_id uuid := 'd4000000-0000-4000-8000-000000000002';
  pos_fetch_id uuid := 'd4000000-0000-4000-8000-000000000003';
  pos_order1_id uuid := 'd4000000-0000-4000-8000-000000000004';
  pos_order2_id uuid := 'd4000000-0000-4000-8000-000000000005';
  payroll_id uuid := 'd4000000-0000-4000-8000-000000000006';
  leave_policy_id uuid := 'd4000000-0000-4000-8000-000000000007';
  meter_id uuid := 'd4000000-0000-4000-8000-000000000008';
  quote_id uuid := 'd4000000-0000-4000-8000-000000000009';
  po_id uuid := 'd4000000-0000-4000-8000-000000000010';
  statement_id uuid := 'd4000000-0000-4000-8000-000000000011';
  journal_purchase_id uuid := 'd8000000-0000-4000-8000-000000000001';
  journal_sales_id uuid := 'd8000000-0000-4000-8000-000000000002';
  rice_lot_id uuid := 'd9000000-0000-4000-8000-000000000001';
  paneer_lot_id uuid := 'd9000000-0000-4000-8000-000000000002';
  account_rev uuid;
  account_inv uuid;
  account_food uuid;
  account_exp uuid;
  account_lab uuid;
  account_ap uuid;
  account_cash uuid;
  account_upi uuid;
  account_tax uuid;
  account_adv uuid;
  account_ded uuid;
  money_cash uuid := 'd7000000-0000-4000-8000-000000000001';
  money_bank uuid := 'd7000000-0000-4000-8000-000000000002';
begin
  if not exists (select 1 from public.settings where restaurant_id = p_restaurant_id and key = 'demo_reset_enabled' and value = 'true') then
    raise exception 'refusing to seed a tenant without demo_reset_enabled';
  end if;

  select id into owner_id from public.app_users where restaurant_id = p_restaurant_id and lower(username) = lower(p_owner_username) and role = 'owner' and status = 'active' limit 1;
  if owner_id is null then raise exception 'demo owner account is missing'; end if;

  update public.restaurants set name = 'KitchenBooks Demo Kitchen', legal_name = 'KitchenBooks Demo Foods Pvt Ltd', address_line1 = '18 Demo Market Road', city = 'Mumbai', state = 'Maharashtra', pincode = '400001', phone = '+91 90000 00000', email = 'demo@kitchenbooks.local', gstin = '27DEMO1234F1Z5', fssai_number = '11526000000000' where id = p_restaurant_id;
  insert into public.settings(restaurant_id, key, value) values
    (p_restaurant_id,'demo_reset_enabled','true'), (p_restaurant_id,'timezone','Asia/Kolkata'), (p_restaurant_id,'business_day_start','05:00'),
    (p_restaurant_id,'pos_stock_policy','reconcile'), (p_restaurant_id,'purchase_approval_mode','threshold'), (p_restaurant_id,'purchase_approval_threshold','10000'),
    (p_restaurant_id,'stock_adjustment_approval_mode','owner')
  on conflict (restaurant_id, key) do update set value = excluded.value;

  -- Keep every demo workflow selectable on first load. These are tenant-owned
  -- managed lists, not hard-coded UI labels.
  insert into public.list_options(restaurant_id, list_key, value, sort_order, status)
  values
    (p_restaurant_id, 'payment_mode', 'Cash', 10, 'active'),
    (p_restaurant_id, 'payment_mode', 'UPI', 20, 'active'),
    (p_restaurant_id, 'payment_mode', 'Bank transfer', 30, 'active'),
    (p_restaurant_id, 'payment_mode', 'Card', 40, 'active'),
    (p_restaurant_id, 'return_reason', 'Quality issue', 10, 'active'),
    (p_restaurant_id, 'return_reason', 'Wrong item', 20, 'active'),
    (p_restaurant_id, 'return_reason', 'Wastage', 30, 'active'),
    (p_restaurant_id, 'vendor_return_reason', 'Damaged goods', 10, 'active'),
    (p_restaurant_id, 'vendor_return_reason', 'Short expiry', 20, 'active'),
    (p_restaurant_id, 'vendor_return_reason', 'Wrong delivery', 30, 'active')
  on conflict (restaurant_id, list_key, value) do update
    set sort_order = excluded.sort_order, status = 'active';

  insert into public.categories(code, name, kind, sort_order, status) values
    ('GROC','Groceries','ingredient',10,'active'), ('VEG','Vegetables','ingredient',20,'active'), ('DAIRY','Dairy','ingredient',30,'active'), ('SPICES','Spices','ingredient',40,'active'), ('BEV','Beverages','ingredient',50,'active'), ('DRY','Dry goods','ingredient',55,'active'), ('PLT','Probe / poultry','ingredient',60,'active')
  on conflict (code) do nothing;
  insert into public.units(code, name) values ('kg','Kilogram'),('ltr','Litre'),('pcs','Pieces'),('piece','Piece'),('portion','Portion') on conflict (code) do nothing;

  insert into public.sections(id, restaurant_id, code, name, sort_order, dept_group, codes_dishes, dept_kind, receives_stock) values
    (cold_id,p_restaurant_id,'ST','Store / Receiving',1,'Support',false,'operational',false), (kitchen_id,p_restaurant_id,'NI','Main Kitchen',2,'Kitchen',true,'kitchen',true),
    (service_id,p_restaurant_id,'SV','Service Counter',3,'Service',false,'operational',true), (dry_id,p_restaurant_id,'BK','Bakery & Prep',4,'Kitchen',true,'kitchen',true)
  on conflict (id) do update set code=excluded.code, name=excluded.name, status='active', receives_stock=excluded.receives_stock, codes_dishes=excluded.codes_dishes;
  -- The demo tenant intentionally has the same 16-department spread used by
  -- the acceptance gates: 12 receiving departments and 4 non-receiving ones.
  insert into public.sections(id, restaurant_id, code, name, sort_order, dept_group, codes_dishes, dept_kind, receives_stock)
  select md5('kitchenbooks-demo-section-' || x.n::text)::uuid, p_restaurant_id,
         x.code, x.name, x.n + 4, x.group_name, x.codes_dishes, x.dept_kind, x.receives_stock
  from (values
    (1,'AC','Accounts Counter','Support',false,'operational',false),
    (2,'VL','Valet','Support',false,'operational',false),
    (3,'SC','Security','Support',false,'operational',false),
    (4,'SI','Staff Issue','Support',false,'operational',true),
    (5,'CH','Chinese Kitchen','Kitchen',true,'kitchen',true),
    (6,'CT','Catering','Kitchen',true,'kitchen',true),
    (7,'TD','Tandoor','Kitchen',true,'kitchen',true),
    (8,'BR','Breakfast','Kitchen',true,'kitchen',true),
    (9,'SF','Staff Food','Kitchen',false,'kitchen',true),
    (10,'KS','Kitchen Store','Kitchen',false,'kitchen',true),
    (11,'HK','Hot Kitchen','Kitchen',true,'kitchen',true),
    (12,'MG','Manager Pantry','Kitchen',true,'kitchen',true)
  ) as x(n,code,name,group_name,codes_dishes,dept_kind,receives_stock)
  on conflict (id) do update set code=excluded.code, name=excluded.name, status='active', receives_stock=excluded.receives_stock, codes_dishes=excluded.codes_dishes;
  insert into public.storage_locations(id, restaurant_id, name, kind, sort_order, status) values
    (cold_id,p_restaurant_id,'Cold Room','chilled',1,'active'), (dry_id,p_restaurant_id,'Dry Store','ambient',2,'active')
  on conflict (id) do update set status='active';

  insert into public.vendors(id, restaurant_id, code, name, primary_category, supplies, gstin, phone, payment_terms, contact_person, address, status) values
    (vendor_id,p_restaurant_id,'V-001','FreshKart Foods','DAIRY',array['Paneer','Milk','Curd'],'27FRESH1234F1Z1','9000000001','15 days','Ravi Shah','Andheri Market, Mumbai','active'),
    (vendor2_id,p_restaurant_id,'V-002','Metro Wholesale','GROC',array['Rice','Oil','Onions'],'27METRO1234F1Z2','9000000002','Cash','Meena Patil','Vashi Wholesale Market','active')
  on conflict (id) do update set status='active';
  insert into public.items(id, restaurant_id, code, name, category, purchase_unit, stock_unit, opening_rate, gst_rate, par_level, reorder_level, storage_location_id, tracks_expiry, status, default_vendor_id) values
    (rice_id,p_restaurant_id,'ING-001','Basmati Rice','GROC','kg','kg',95,5,40,15,dry_id,false,'active',vendor2_id),
    (paneer_id,p_restaurant_id,'ING-002','Paneer','DAIRY','kg','kg',320,5,12,5,cold_id,true,'active',vendor_id),
    (onion_id,p_restaurant_id,'ING-003','Onions','VEG','kg','kg',42,0,30,10,dry_id,false,'active',vendor2_id),
    (tomato_id,p_restaurant_id,'ING-004','Tomatoes','VEG','kg','kg',55,0,25,8,cold_id,true,'active',vendor2_id),
    (oil_id,p_restaurant_id,'ING-005','Sunflower Oil','GROC','ltr','ltr',145,5,20,6,dry_id,false,'active',vendor2_id)
  on conflict (id) do update set status='active';

  insert into public.staff(id, restaurant_id, code, name, designation, section_id, grade, employment_type, base_salary, pay_mode, joined, phone, status) values
    ('d5000000-0000-4000-8000-000000000001',p_restaurant_id,'EMP-001','Amit Kulkarni','Kitchen Manager',kitchen_id,'L4','full_time',42000,'account',current_date-900,'9000000101','active'),
    ('d5000000-0000-4000-8000-000000000002',p_restaurant_id,'EMP-002','Neha Joshi','Head Chef',kitchen_id,'L5','full_time',38000,'account',current_date-700,'9000000102','active'),
    ('d5000000-0000-4000-8000-000000000003',p_restaurant_id,'EMP-003','Suresh Yadav','Store Keeper',service_id,'L3','full_time',28000,'cash',current_date-500,'9000000103','active'),
    ('d5000000-0000-4000-8000-000000000004',p_restaurant_id,'EMP-004','Pooja Nair','Cashier',service_id,'L2','full_time',26000,'account',current_date-400,'9000000104','active'),
    ('d5000000-0000-4000-8000-000000000005',p_restaurant_id,'EMP-005','Imran Khan','Kitchen Assistant',kitchen_id,'L1','trainee',18000,'cash',current_date-200,'9000000105','active')
  on conflict (id) do update set status='active', section_id=excluded.section_id;

  insert into public.user_accounts(id, username, display_name, password_hash, status) values
    ('d6000000-0000-4000-8000-000000000001','demo_manager','Demo Manager','$2b$10$K1Baus956iafLMRn5ydrc.cTVpTzYl4wmx/r6VyPPJvJfld72YAUq','active'),
    ('d6000000-0000-4000-8000-000000000002','demo_chef','Demo Chef','$2b$10$K1Baus956iafLMRn5ydrc.cTVpTzYl4wmx/r6VyPPJvJfld72YAUq','active'),
    ('d6000000-0000-4000-8000-000000000003','demo_store','Demo Store','$2b$10$K1Baus956iafLMRn5ydrc.cTVpTzYl4wmx/r6VyPPJvJfld72YAUq','active'),
    ('d6000000-0000-4000-8000-000000000004','demo_cashier','Demo Cashier','$2b$10$K1Baus956iafLMRn5ydrc.cTVpTzYl4wmx/r6VyPPJvJfld72YAUq','active'),
    ('d6000000-0000-4000-8000-000000000005','demo_accounts','Demo Accountant','$2b$10$K1Baus956iafLMRn5ydrc.cTVpTzYl4wmx/r6VyPPJvJfld72YAUq','active')
  on conflict (id) do update set password_hash=excluded.password_hash, status='active';
  insert into public.app_users(id, restaurant_id, username, display_name, role, staff_id, password_hash, status) values
    ('d6000000-0000-4000-8000-000000000001',p_restaurant_id,'demo_manager','Demo Manager','manager','d5000000-0000-4000-8000-000000000001','$2b$10$K1Baus956iafLMRn5ydrc.cTVpTzYl4wmx/r6VyPPJvJfld72YAUq','active'),
    ('d6000000-0000-4000-8000-000000000002',p_restaurant_id,'demo_chef','Demo Chef','chef','d5000000-0000-4000-8000-000000000002','$2b$10$K1Baus956iafLMRn5ydrc.cTVpTzYl4wmx/r6VyPPJvJfld72YAUq','active'),
    ('d6000000-0000-4000-8000-000000000003',p_restaurant_id,'demo_store','Demo Store','store','d5000000-0000-4000-8000-000000000003','$2b$10$K1Baus956iafLMRn5ydrc.cTVpTzYl4wmx/r6VyPPJvJfld72YAUq','active'),
    ('d6000000-0000-4000-8000-000000000004',p_restaurant_id,'demo_cashier','Demo Cashier','cashier','d5000000-0000-4000-8000-000000000004','$2b$10$K1Baus956iafLMRn5ydrc.cTVpTzYl4wmx/r6VyPPJvJfld72YAUq','active'),
    ('d6000000-0000-4000-8000-000000000005',p_restaurant_id,'demo_accounts','Demo Accountant','accountant',null,'$2b$10$K1Baus956iafLMRn5ydrc.cTVpTzYl4wmx/r6VyPPJvJfld72YAUq','active')
  on conflict (id) do update set status='active';
  insert into public.restaurant_memberships(restaurant_id, account_id, role, staff_id, status) values
    (p_restaurant_id,owner_id,'owner',null,'active')
  on conflict do nothing;
  update public.restaurant_memberships set restaurant_id=p_restaurant_id where account_id in ('d6000000-0000-4000-8000-000000000001'::uuid,'d6000000-0000-4000-8000-000000000002'::uuid,'d6000000-0000-4000-8000-000000000003'::uuid,'d6000000-0000-4000-8000-000000000004'::uuid,'d6000000-0000-4000-8000-000000000005'::uuid) and restaurant_id <> p_restaurant_id;
  insert into public.restaurant_memberships(restaurant_id, account_id, role, staff_id, status) values
    (p_restaurant_id,'d6000000-0000-4000-8000-000000000001'::uuid,'manager','d5000000-0000-4000-8000-000000000001'::uuid,'active'),
    (p_restaurant_id,'d6000000-0000-4000-8000-000000000002'::uuid,'chef','d5000000-0000-4000-8000-000000000002'::uuid,'active'),
    (p_restaurant_id,'d6000000-0000-4000-8000-000000000003'::uuid,'store','d5000000-0000-4000-8000-000000000003'::uuid,'active'),
    (p_restaurant_id,'d6000000-0000-4000-8000-000000000004'::uuid,'cashier','d5000000-0000-4000-8000-000000000004'::uuid,'active'),
    (p_restaurant_id,'d6000000-0000-4000-8000-000000000005'::uuid,'accountant',null,'active')
  on conflict (restaurant_id, account_id) do update set status='active';

  insert into public.recipes(id, restaurant_id, code, name, kind, section_id, output_qty, output_unit, selling_price, status, pos_code, diet, portions, portion_size, portion_unit) values
    (gravy_id,p_restaurant_id,'SUB-001','House Gravy Base','sub',null,10,'kg',null,'active',null,null,null,null,null),
    (rice_bowl_id,p_restaurant_id,'DISH-001','Paneer Rice Bowl','dish',kitchen_id,1,'portion',220,'active','PP-001','Veg',1,1,'portion'),
    (paneer_bowl_id,p_restaurant_id,'DISH-002','Paneer Tikka Plate','dish',service_id,1,'portion',280,'active','PP-002','Veg',1,1,'portion')
  on conflict (id) do update set status='active';
  insert into public.recipe_lines(id, recipe_id, restaurant_id, component_item_id, qty, yield_pct, note) values
    ('d3100000-0000-4000-8000-000000000001',gravy_id,p_restaurant_id,onion_id,1,100,'Base aromatics'),
    ('d3100000-0000-4000-8000-000000000002',gravy_id,p_restaurant_id,tomato_id,2,100,'Base sauce'),
    ('d3100000-0000-4000-8000-000000000003',rice_bowl_id,p_restaurant_id,rice_id,0.18,100,'Basmati rice'),
    ('d3100000-0000-4000-8000-000000000004',rice_bowl_id,p_restaurant_id,paneer_id,0.12,100,'Paneer'),
    ('d3100000-0000-4000-8000-000000000005',paneer_bowl_id,p_restaurant_id,paneer_id,0.20,100,'Paneer'),
    ('d3100000-0000-4000-8000-000000000006',paneer_bowl_id,p_restaurant_id,oil_id,0.03,100,'Cooking oil')
  on conflict (id) do nothing;
  insert into public.recipe_line_substitutions(restaurant_id, recipe_line_id, substitute_item_id, quantity_ratio, note, entered_by)
  values (p_restaurant_id,'d3100000-0000-4000-8000-000000000004'::uuid,onion_id,1,'Use tofu when paneer is unavailable','demo')
  on conflict do nothing;

  insert into public.accounting_accounts(restaurant_id, code, name, account_type) values
    (p_restaurant_id,'REV','Sales Revenue','revenue'),(p_restaurant_id,'INV','Inventory Asset','asset'),(p_restaurant_id,'FOOD','Food Cost','expense'),(p_restaurant_id,'EXP','Operating Expense','expense'),(p_restaurant_id,'LAB','Labour Expense','expense'),(p_restaurant_id,'AP','Vendor Payable','liability'),(p_restaurant_id,'CASH','Cash Till','asset'),(p_restaurant_id,'UPI','UPI Settlement','asset'),(p_restaurant_id,'TAX','Tax Payable','liability'),(p_restaurant_id,'ADV','Staff Advance','asset'),(p_restaurant_id,'DED','Payroll Deductions','liability')
  on conflict (restaurant_id, code) do nothing;
  select id into account_rev from public.accounting_accounts where restaurant_id=p_restaurant_id and code='REV'; select id into account_inv from public.accounting_accounts where restaurant_id=p_restaurant_id and code='INV'; select id into account_food from public.accounting_accounts where restaurant_id=p_restaurant_id and code='FOOD'; select id into account_exp from public.accounting_accounts where restaurant_id=p_restaurant_id and code='EXP'; select id into account_lab from public.accounting_accounts where restaurant_id=p_restaurant_id and code='LAB'; select id into account_ap from public.accounting_accounts where restaurant_id=p_restaurant_id and code='AP'; select id into account_cash from public.accounting_accounts where restaurant_id=p_restaurant_id and code='CASH'; select id into account_upi from public.accounting_accounts where restaurant_id=p_restaurant_id and code='UPI'; select id into account_tax from public.accounting_accounts where restaurant_id=p_restaurant_id and code='TAX'; select id into account_adv from public.accounting_accounts where restaurant_id=p_restaurant_id and code='ADV'; select id into account_ded from public.accounting_accounts where restaurant_id=p_restaurant_id and code='DED';
  insert into public.accounting_posting_mappings(restaurant_id,mapping_key,account_id,updated_by) values
    (p_restaurant_id,'sales_revenue',account_rev,'demo'),(p_restaurant_id,'inventory_asset',account_inv,'demo'),(p_restaurant_id,'food_cost',account_food,'demo'),(p_restaurant_id,'operating_expense',account_exp,'demo'),(p_restaurant_id,'labour_expense',account_lab,'demo'),(p_restaurant_id,'vendor_payable',account_ap,'demo'),(p_restaurant_id,'pos_cash_asset',account_cash,'demo'),(p_restaurant_id,'pos_upi_asset',account_upi,'demo'),(p_restaurant_id,'tax_payable',account_tax,'demo'),(p_restaurant_id,'staff_advance_asset',account_adv,'demo'),(p_restaurant_id,'payroll_deduction_payable',account_ded,'demo')
  on conflict (restaurant_id,mapping_key) do update set account_id=excluded.account_id;
  insert into public.money_accounts(id,restaurant_id,name,kind,opening_balance,sort_order,status,is_till,accounting_account_id) values (money_cash,p_restaurant_id,'Main Cash Till','cash',8500,1,'active',true,account_cash),(money_bank,p_restaurant_id,'HDFC Current Account','bank',125000,2,'active',false,account_upi) on conflict (id) do nothing;

  insert into public.purchases(id,restaurant_id,bill_date,vendor_id,bill_no,goods_total,gst_total,transport,entered_by) values (purchase_id,p_restaurant_id,current_date-2,vendor_id,'DEMO-BILL-001',9850,429.5,180,'demo') on conflict (id) do update set goods_total=excluded.goods_total, gst_total=excluded.gst_total, transport=excluded.transport, bill_date=excluded.bill_date;
  delete from public.purchase_lines pl where pl.purchase_id = 'd4000000-0000-4000-8000-000000000001'::uuid;
  insert into public.purchase_lines(purchase_id,restaurant_id,item_id,qty,rate,gst_amount,transport_alloc,expiry_date) values (purchase_id,p_restaurant_id,rice_id,50,95,237.5,50,null),(purchase_id,p_restaurant_id,paneer_id,12,320,192,100,current_date+7),(purchase_id,p_restaurant_id,onion_id,30,42,0,30,null) on conflict do nothing;
  insert into public.stock_lots(id,restaurant_id,item_id,lot_code,received_date,expiry_date,initial_qty,unit_cost,location_id,source_purchase_line_id) values (rice_lot_id,p_restaurant_id,rice_id,'DEMO-RICE-001',current_date-2,null,50,95,dry_id,null),(paneer_lot_id,p_restaurant_id,paneer_id,'DEMO-PANEER-001',current_date-2,current_date+7,12,320,cold_id,null) on conflict (id) do nothing;
  insert into public.stock_lot_movements(restaurant_id,lot_id,quantity_delta,movement_date,movement_type,location_id,source_id,entered_by) values (p_restaurant_id,rice_lot_id,-8,current_date-1,'issue',dry_id,issue_id,'demo_store'),(p_restaurant_id,paneer_lot_id,-3,current_date-1,'issue',cold_id,issue_id,'demo_store') on conflict do nothing;
  insert into public.purchase_orders(id,restaurant_id,doc_no,vendor_id,po_date,status,entered_by,approval_status) values (po_id,p_restaurant_id,'PO-DEMO-001',vendor2_id,current_date-1,'draft','demo','pending') on conflict (id) do nothing;
  insert into public.purchase_order_lines(restaurant_id,purchase_order_id,item_id,qty,rate) values (p_restaurant_id,po_id,rice_id,80,92),(p_restaurant_id,po_id,oil_id,25,140) on conflict do nothing;
  insert into public.purchase_order_approvals(restaurant_id,purchase_order_id,status,amount,reason,requested_by) values (p_restaurant_id,po_id,'pending',10860,'Monthly rice and oil replenishment','demo_manager') on conflict do nothing;
  insert into public.purchase_quotes(id,restaurant_id,vendor_id,quote_date,valid_until,status,reference,note,entered_by) values (quote_id,p_restaurant_id,vendor_id,current_date-3,current_date+12,'accepted','QUOTE-FRESH-082','Best paneer rate for the week','demo') on conflict (id) do nothing;
  insert into public.purchase_quote_lines(restaurant_id,quote_id,item_id,qty,rate,note) values (p_restaurant_id,quote_id,paneer_id,20,305,'Accepted quote line') on conflict do nothing;
  insert into public.purchase_invoice_matches(restaurant_id,purchase_id,purchase_order_id,status,quantity_exception,price_exception,snapshot,assessed_by) values (p_restaurant_id,purchase_id,null,'unmatched',false,false,'{"reason":"Historical bill without PO"}'::jsonb,'demo_accounts') on conflict do nothing;

  -- Keep one visible, harmless approval in the demo queue so the owner flow
  -- has something to inspect on a fresh reset.
  insert into public.approval_requests
    (id, restaurant_id, kind, entity_type, entity_id, reason, snapshot, status,
     requested_by, amount, suggested_mode, bills_from, bills_to, assigned_to)
  values
    ('d4000000-0000-4000-8000-000000000012', p_restaurant_id, 'payment', 'vendor', vendor_id,
     'Monthly demo replenishment', jsonb_build_object('vendor_code','V-002','askedRangeBills',1), 'applied',
     'demo_manager', 10860, 'Cash', current_date - 30, current_date, null)
  on conflict (id) do update set status='applied', assigned_to=null, amount=excluded.amount,
    snapshot=jsonb_build_object('vendor_code','V-002','askedRangeBills',1);
  insert into public.approval_events (restaurant_id, request_id, action, acted_by, note)
  select p_restaurant_id, 'd4000000-0000-4000-8000-000000000012'::uuid, 'raised', 'demo_manager', 'Demo approval request'
  where not exists (select 1 from public.approval_events where request_id = 'd4000000-0000-4000-8000-000000000012'::uuid);
  insert into public.approval_requests
    (id, restaurant_id, kind, entity_type, entity_id, reason, snapshot, status,
     requested_by, assigned_to)
  values
    ('d4000000-0000-4000-8000-000000000013', p_restaurant_id, 'payment', 'vendor', vendor_id,
     'Whole balance demo request', jsonb_build_object('vendor_code','V-002'), 'pending',
     'demo_manager', 'owner')
  on conflict (id) do update set entity_id=excluded.entity_id, status='pending', assigned_to='owner', bills_from=null, bills_to=null;
  insert into public.approval_events (restaurant_id, request_id, action, acted_by, note)
  select p_restaurant_id, 'd4000000-0000-4000-8000-000000000013'::uuid, 'raised', 'demo_manager', 'Demo whole-balance request'
  where not exists (select 1 from public.approval_events where request_id = 'd4000000-0000-4000-8000-000000000013'::uuid);

  insert into public.issues(id,restaurant_id,issue_date,section_id,note,entered_by,session) values (issue_id,p_restaurant_id,current_date-1,kitchen_id,'Morning kitchen issue','demo_store','Morning') on conflict (id) do nothing;
  insert into public.issue_lines(issue_id,restaurant_id,item_id,qty,unit_cost) values (issue_id,p_restaurant_id,rice_id,8,95),(issue_id,p_restaurant_id,paneer_id,3,320),(issue_id,p_restaurant_id,onion_id,4,42) on conflict do nothing;
  insert into public.productions(id,restaurant_id,section_id,prod_date,recipe_id,output_qty,unit_cost,note,entered_by,expected_output_qty,waste_qty) values ('d4100000-0000-4000-8000-000000000001',p_restaurant_id,kitchen_id,current_date-1,rice_bowl_id,42,82,'Lunch prep','demo_chef',45,3) on conflict (id) do nothing;
  insert into public.production_variance_reviews(restaurant_id,recipe_id,month_start,status,note) values (p_restaurant_id,rice_bowl_id,date_trunc('month',current_date)::date,'open','Review lunch prep variance') on conflict do nothing;

  insert into public.pos_fetches(id,restaurant_id,business_date,order_count,note) values (pos_fetch_id,p_restaurant_id,current_date-1,4,'Demo Petpooja-shaped fetch') on conflict (id) do nothing;
  insert into public.pos_orders(id,fetch_id,restaurant_id,business_date,pos_order_id,channel,order_type,payment_mode,covers,status_raw,status_class,subtotal,tax,order_total,order_time) values
    (pos_order1_id,pos_fetch_id,p_restaurant_id,current_date-1,'DEMO-1001','Dine-in','Dine-in','Cash',2,'Success','revenue',440,22,462,current_date-1+'12:10'::time),
    (pos_order2_id,pos_fetch_id,p_restaurant_id,current_date-1,'DEMO-1002','Delivery','Delivery','UPI',3,'Success','revenue',700,35,735,current_date-1+'19:45'::time),
    ('d4000000-0000-4000-8000-000000000011'::uuid,pos_fetch_id,p_restaurant_id,current_date-1,'DEMO-1003','Dine-in','Dine-in','Cash',1,'Cancelled','cancelled',200,10,210,current_date-1+'20:15'::time)
  on conflict (id) do nothing;
  insert into public.pos_lines(order_id,restaurant_id,pos_item_id,item_name,qty,amount) values (pos_order1_id,p_restaurant_id,'PP-001','Paneer Rice Bowl',2,440),(pos_order2_id,p_restaurant_id,'PP-002','Paneer Tikka Plate',2,560),(pos_order2_id,p_restaurant_id,'PP-001','Paneer Rice Bowl',1,220) on conflict do nothing;
  insert into public.pos_item_map(restaurant_id,pos_item_id,item_name,recipe_id,section_id) values (p_restaurant_id,'PP-001','Paneer Rice Bowl',rice_bowl_id,kitchen_id),(p_restaurant_id,'PP-002','Paneer Tikka Plate',paneer_bowl_id,service_id) on conflict do nothing;
  insert into public.pos_sync_runs(restaurant_id,business_date,status,attempt,finished_at,fetch_id) values (p_restaurant_id,current_date-1,'succeeded',1,now(),pos_fetch_id),(p_restaurant_id,current_date,'failed',3,now(),null) on conflict do nothing;

  insert into public.leave_policies(id,restaurant_id,code,name,annual_days,paid_days,carry_forward,status,entered_by) values (leave_policy_id,p_restaurant_id,'REG','Regular Leave',24,12,true,'active','demo_accounts') on conflict (id) do nothing;
  insert into public.staff_leave_policy_assignments(restaurant_id,staff_id,policy_id,effective_from,entered_by) values (p_restaurant_id,'d5000000-0000-4000-8000-000000000001'::uuid,leave_policy_id,current_date-365,'demo_accounts'),(p_restaurant_id,'d5000000-0000-4000-8000-000000000002'::uuid,leave_policy_id,current_date-365,'demo_accounts') on conflict do nothing;
  insert into public.salary_structures(restaurant_id,staff_id,effective_from,base_salary,note,entered_by) values (p_restaurant_id,'d5000000-0000-4000-8000-000000000001'::uuid,current_date-365,42000,'Current salary','demo_accounts'),(p_restaurant_id,'d5000000-0000-4000-8000-000000000002'::uuid,current_date-365,38000,'Current salary','demo_accounts') on conflict do nothing;
  insert into public.payroll_statutory_configs(restaurant_id,effective_from,jurisdiction,pf_employee_pct,pf_employer_pct,pf_wage_cap,esi_employee_pct,esi_employer_pct,esi_wage_cap,tds_regime,note,entered_by) values (p_restaurant_id,date_trunc('month',current_date)::date,'IN',12,12,15000,0.75,3.25,21000,'default','Demo accountant-entered configuration','demo_accounts') on conflict do nothing;
  insert into public.attendance(restaurant_id,att_date,staff_id,status,note,entered_by,seq) values (p_restaurant_id,current_date-1,'d5000000-0000-4000-8000-000000000001'::uuid,'present','Opening shift','demo_manager',1),(p_restaurant_id,current_date-1,'d5000000-0000-4000-8000-000000000002'::uuid,'present','Kitchen shift','demo_manager',2),(p_restaurant_id,current_date-1,'d5000000-0000-4000-8000-000000000003'::uuid,'leave','Approved leave','demo_manager',3) on conflict do nothing;
  insert into public.leave_requests(restaurant_id,staff_id,policy_id,start_date,end_date,requested_days,note,status,requested_by,decided_by,decided_at) values (p_restaurant_id,'d5000000-0000-4000-8000-000000000003'::uuid,leave_policy_id,current_date+3,current_date+4,2,'Family function','pending','demo_store',null,null) on conflict do nothing;
  insert into public.staff_holidays(restaurant_id,holiday_date,name,paid,entered_by) values (p_restaurant_id,current_date+5,'Demo Foundation Day',true,'demo_manager') on conflict do nothing;
  insert into public.payroll_runs(id,restaurant_id,period_start,period_end,doc_no,status,prepared_by,note) values (payroll_id,p_restaurant_id,date_trunc('month',current_date)::date,(date_trunc('month',current_date)+'1 month - 1 day')::date,'PAY-DEMO-001','approved','demo_accounts','Demo payroll run') on conflict (id) do nothing;
  insert into public.payroll_lines(restaurant_id,run_id,staff_id,days_in_period,days_paid,base_salary,earned,overtime,advance_recovered,other_deduction,withholding,net_payable,pay_mode,note) values (p_restaurant_id,payroll_id,'d5000000-0000-4000-8000-000000000001'::uuid,30,30,42000,42000,1500,0,0,5040,38460,'account','Demo payroll line'),(p_restaurant_id,payroll_id,'d5000000-0000-4000-8000-000000000002'::uuid,30,29,38000,36733.33,0,0,0,4408,32325.33,'account','Demo payroll line') on conflict do nothing;

  insert into public.meters(id,restaurant_id,name,kind,unit,assumed_rate,status) values (meter_id,p_restaurant_id,'Main Electricity Meter','electricity','kWh',12,'active') on conflict (id) do nothing;
  insert into public.meter_readings(restaurant_id,meter_id,read_date,reading,note,entered_by,seq) values (p_restaurant_id,meter_id,current_date-7,18420,'Weekly reading','demo_manager',1),(p_restaurant_id,meter_id,current_date,18780,'Current reading','demo_manager',2) on conflict do nothing;
  insert into public.expenses(restaurant_id,expense_date,category,payee,amount,paid_via,note,entered_by,account_id,doc_no) values (p_restaurant_id,current_date-2,'Repairs','CoolFix Services',2400,'cash','Cold-room service','demo_manager',money_cash,'EXP-DEMO-001') on conflict do nothing;
  insert into public.other_income(restaurant_id,income_date,item,qty,unit,amount,buyer,received_by,account_id) values (p_restaurant_id,current_date-1,'Catering deposit',1,'portion',12000,'Demo Corporate Client','demo_cashier',money_bank) on conflict do nothing;
  insert into public.cash_vouchers(restaurant_id,voucher_date,amount,paid_to,paid_by,category,note,entered_by,account_id,doc_no) values (p_restaurant_id,current_date-1,850,'Local taxi','cashier','operating','Urgent vendor pickup','demo_cashier',money_cash,'CV-DEMO-001') on conflict do nothing;

  insert into public.recurring_journal_templates(restaurant_id,name,day_of_month,start_date,status,created_by) values (p_restaurant_id,'Monthly kitchen rent',1,date_trunc('month',current_date)::date,'active','demo_accounts') on conflict do nothing;
  insert into public.accruals(restaurant_id,name,accrual_date,reversal_date,amount,expense_account_id,liability_account_id,status,created_by) values (p_restaurant_id,'Month-end electricity accrual',date_trunc('month',current_date)::date,(date_trunc('month',current_date)+'1 month')::date,6500,account_exp,account_ap,'open','demo_accounts') on conflict do nothing;
  insert into public.fixed_assets(restaurant_id,asset_code,name,purchase_date,in_service_date,cost,salvage_value,useful_life_months,asset_account_id,depreciation_expense_account_id,accumulated_depreciation_account_id,status,created_by) values (p_restaurant_id,'FA-001','Commercial Refrigerator',current_date-180,current_date-170,185000,5000,60,account_inv,account_exp,account_inv,'active','demo_accounts') on conflict do nothing;

  insert into public.pos_statement_imports(id,restaurant_id,provider,imported_by,note) values (statement_id,p_restaurant_id,'Petpooja','demo_accounts','Demo provider statement for reconciliation') on conflict (id) do nothing;
  insert into public.pos_statement_lines(restaurant_id,import_id,business_date,pos_order_id,amount,payment_mode,status) values (p_restaurant_id,statement_id,current_date-1,'DEMO-1001',462,'Cash','Success'),(p_restaurant_id,statement_id,current_date-1,'DEMO-1002',735,'UPI','Success'),(p_restaurant_id,statement_id,current_date-1,'DEMO-1004',150,'Cash','Success') on conflict do nothing;
  insert into public.pos_reconciliation_reviews(restaurant_id,import_id,business_date,status,note,reviewed_by) values (p_restaurant_id,statement_id,current_date-1,'open','One provider order is not present in the current books','demo_accounts') on conflict do nothing;
  insert into public.recipe_versions(restaurant_id,recipe_id,version_no,effective_from,snapshot,recorded_by) values
    (p_restaurant_id,rice_bowl_id,1,now()-interval '20 days',jsonb_build_object('recipe','Paneer Rice Bowl','lines',jsonb_build_array(jsonb_build_object('item','Basmati Rice','qty',0.18),jsonb_build_object('item','Paneer','qty',0.12))),'demo'),
    (p_restaurant_id,paneer_bowl_id,1,now()-interval '20 days',jsonb_build_object('recipe','Paneer Tikka Plate','lines',jsonb_build_array(jsonb_build_object('item','Paneer','qty',0.20),jsonb_build_object('item','Sunflower Oil','qty',0.03))),'demo')
  on conflict do nothing;
  insert into public.journal_entries(id,restaurant_id,entry_date,source_type,source_id,memo,posted_by) values (journal_purchase_id,p_restaurant_id,current_date-2,'demo_purchase',purchase_id,'Demo purchase and payable','demo_accounts'),(journal_sales_id,p_restaurant_id,current_date-1,'demo_pos',pos_fetch_id,'Demo POS revenue','demo_accounts') on conflict (id) do nothing;
  insert into public.journal_lines(restaurant_id,journal_entry_id,account_id,description,debit,credit) values
    (p_restaurant_id,journal_purchase_id,account_inv,'Inventory received',15620,0),(p_restaurant_id,journal_purchase_id,account_ap,'Vendor payable',0,15620),
    (p_restaurant_id,journal_sales_id,account_cash,'Cash sales',462,0),(p_restaurant_id,journal_sales_id,account_upi,'UPI sales',735,0),(p_restaurant_id,journal_sales_id,account_rev,'Sales revenue',0,1197)
  on conflict do nothing;
  insert into public.staff_leave_policy_assignments(restaurant_id,staff_id,policy_id,effective_from,entered_by) values (p_restaurant_id,'d5000000-0000-4000-8000-000000000003'::uuid,leave_policy_id,current_date-365,'demo_accounts') on conflict do nothing;
end;
$$;

revoke all on function public.reset_demo_tenant(uuid, text) from public;
revoke all on function public.seed_demo_tenant(uuid, text) from public;
grant execute on function public.reset_demo_tenant(uuid, text) to kb_app;
grant execute on function public.seed_demo_tenant(uuid, text) to kb_app;

commit;
