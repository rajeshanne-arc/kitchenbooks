-- Deterministic probe tenant enrichment for the disposable integration DB.
-- Never run against a shared or production database.

begin;

insert into categories(code, name, kind, sort_order, status)
values ('PLT', 'Probe Plate', 'ingredient', 99, 'active')
on conflict (code) do nothing;

insert into storage_locations (id, restaurant_id, name, kind, sort_order, status)
values
 ('e5200000-0000-4000-8000-000000000001','01d93395-7c3f-4b1c-a06a-dbc7a660770c','Probe Cold Room','chilled',1,'active'),
 ('e5200000-0000-4000-8000-000000000002','01d93395-7c3f-4b1c-a06a-dbc7a660770c','Probe Dry Store','ambient',2,'active')
on conflict (id) do update set restaurant_id=excluded.restaurant_id,status='active';

insert into vendors (id, restaurant_id, code, name, primary_category, phone, payment_terms, status)
values
 ('e5300000-0000-4000-8000-000000000001','01d93395-7c3f-4b1c-a06a-dbc7a660770c','PV-001','Probe Fresh Foods','GROC','9000000201','15 days','active'),
 ('e5300000-0000-4000-8000-000000000002','01d93395-7c3f-4b1c-a06a-dbc7a660770c','PV-002','Probe Metro Wholesale','GROC','9000000202','Cash','active')
on conflict (id) do update set restaurant_id=excluded.restaurant_id,status='active';

insert into items (id, restaurant_id, code, name, category, purchase_unit, stock_unit, opening_rate, reorder_level, storage_location_id, status, default_vendor_id)
values
 ('e5400000-0000-4000-8000-000000000001','01d93395-7c3f-4b1c-a06a-dbc7a660770c','PI-001','Probe Rice','GROC','kg','kg',95,10,'e5200000-0000-4000-8000-000000000002','active','e5300000-0000-4000-8000-000000000002'),
 ('e5400000-0000-4000-8000-000000000002','01d93395-7c3f-4b1c-a06a-dbc7a660770c','PI-002','Probe Paneer','GROC','kg','kg',320,5,'e5200000-0000-4000-8000-000000000001','active','e5300000-0000-4000-8000-000000000001'),
 ('e5400000-0000-4000-8000-000000000003','01d93395-7c3f-4b1c-a06a-dbc7a660770c','PI-003','Probe Oil','GROC','ltr','ltr',145,5,'e5200000-0000-4000-8000-000000000002','active','e5300000-0000-4000-8000-000000000002')
on conflict (id) do update set restaurant_id=excluded.restaurant_id,status='active';

insert into staff (id, restaurant_id, code, name, designation, section_id, grade, employment_type, base_salary, pay_mode, joined, status)
values
 ('e5500000-0000-4000-8000-000000000001','01d93395-7c3f-4b1c-a06a-dbc7a660770c','PE-001','Probe Manager','Manager','e038f183-b9f1-4306-9598-955da5f3588a','L4','full_time',42000,'account',current_date-500,'active'),
 ('e5500000-0000-4000-8000-000000000002','01d93395-7c3f-4b1c-a06a-dbc7a660770c','PE-002','Probe Chef','Chef','e038f183-b9f1-4306-9598-955da5f3588a','L5','full_time',38000,'account',current_date-400,'active'),
 ('e5500000-0000-4000-8000-000000000003','01d93395-7c3f-4b1c-a06a-dbc7a660770c','PE-003','Probe Storekeeper','Store','e43fe1d1-5469-445b-b473-e224d23c566f','L3','full_time',28000,'cash',current_date-300,'active'),
 ('e5500000-0000-4000-8000-000000000004','01d93395-7c3f-4b1c-a06a-dbc7a660770c','PE-004','Probe Cashier','Cashier','20990568-eeab-4382-92d9-654508d83c11','L2','full_time',26000,'account',current_date-200,'active')
on conflict (id) do update set restaurant_id=excluded.restaurant_id,status='active';

insert into list_options (restaurant_id, list_key, value, sort_order, status)
values
 ('01d93395-7c3f-4b1c-a06a-dbc7a660770c','payment_mode','Cash',10,'active'),
 ('01d93395-7c3f-4b1c-a06a-dbc7a660770c','payment_mode','UPI',20,'active'),
 ('01d93395-7c3f-4b1c-a06a-dbc7a660770c','payment_mode','Bank transfer',30,'active'),
 ('01d93395-7c3f-4b1c-a06a-dbc7a660770c','payment_mode','Card',40,'active'),
 ('01d93395-7c3f-4b1c-a06a-dbc7a660770c','return_reason','Quality issue',10,'active'),
 ('01d93395-7c3f-4b1c-a06a-dbc7a660770c','vendor_return_reason','Damaged goods',10,'active')
on conflict (restaurant_id, list_key, value) do update set status='active';

commit;
