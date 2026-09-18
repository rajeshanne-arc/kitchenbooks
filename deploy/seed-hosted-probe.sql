-- Non-production acceptance baseline. The target is an isolated probe tenant.
insert into categories(code, name, kind, sort_order, status) values
  ('GROC', 'Groceries', 'ingredient', 10, 'active'),
  ('VEG', 'Vegetables', 'ingredient', 20, 'active'),
  ('NONVEG', 'Non-vegetarian', 'ingredient', 21, 'active')
on conflict (code) do nothing;
insert into units(code, name) values
  ('kg', 'Kilogram'), ('portion', 'Portion'), ('ltr', 'Litre')
on conflict (code) do nothing;

insert into accounting_accounts(restaurant_id, code, name, account_type)
select :'rid'::uuid, code, name, account_type from (values
  ('REV','Sales revenue','revenue'), ('INV','Inventory asset','asset'),
  ('FOOD','Food cost','expense'), ('EXP','Operating expense','expense'),
  ('LAB','Labour expense','expense'), ('AP','Vendor payable','liability'),
  ('AR','POS receivable','asset'), ('CASH','POS cash','asset'),
  ('UPI','POS UPI','asset'), ('CARD','POS card','asset'),
  ('DEL','POS delivery','asset'), ('OTHER','POS other','asset'),
  ('TAX','Tax payable','liability'), ('FUND','Staff fund','liability'),
  ('ADV','Staff advance','asset'), ('DED','Payroll deductions','liability'),
  ('OI','Other income','revenue')
) accounts(code, name, account_type)
on conflict (restaurant_id, code) do nothing;

insert into accounting_posting_mappings(restaurant_id, mapping_key, account_id, updated_by)
select :'rid'::uuid, key, a.id, 'hosted-probe'
from (values
  ('vendor_payable','AP'), ('owner_payable','AP'), ('sales_revenue','REV'),
  ('other_income_revenue','OI'), ('inventory_asset','INV'), ('input_tax_asset','INV'),
  ('food_cost','FOOD'), ('operating_expense','EXP'), ('labour_expense','LAB'),
  ('withholding_payable','DED'), ('staff_advance_asset','ADV'),
  ('payroll_deduction_payable','DED'), ('tax_payable','TAX'), ('staff_fund','FUND'),
  ('pos_cash_asset','CASH'), ('pos_upi_asset','UPI'), ('pos_card_asset','CARD'),
  ('pos_delivery_asset','DEL'), ('pos_receivable_asset','AR'), ('pos_other_asset','OTHER')
) mappings(key, code)
join accounting_accounts a on a.restaurant_id = :'rid'::uuid and a.code = mappings.code
on conflict (restaurant_id, mapping_key) do nothing;
