-- views_security_invoker
--
-- A VIEW WITHOUT `security_invoker` RUNS AS ITS OWNER. The owner here is
-- `postgres`, which has BYPASSRLS — so every policy on every base table is
-- skipped, and the view returns EVERY TENANT'S ROWS to whoever can select
-- from it.
--
-- Measured as kb_app with bypassrls off, announcing the probe tenant and
-- counting rows belonging to the live one:
--
--   attendance_current 15 · labour_cost_daily 15 · day_summary 11 ·
--   vendor_supplied_items 7 · vendor_dues 5 · vendor_performance 5 ·
--   attendance_summary 3 · labour_hours_by_section 3 ·
--   sales_per_labour_hour 3 · section_frequent_items 3 ·
--   headcount_by_section 2 · advances_outstanding 1 ·
--   business_day_disagreements 1
--
-- Vendor balances, attendance, staff advances and a whole day's trading,
-- readable across the tenant boundary.
--
-- NINE MORE CARRY THE SAME DEFECT AND DID NOT LEAK, which is worse rather
-- than better: they were saved by an INNER view that happens to have
-- security_invoker (sales_current joins latest_fetches, which is scoped, so
-- the join came back empty). Nothing about them is safe; they are one
-- migration to a neighbouring view away from leaking too.
--
-- WHY THE APP DID NOT LEAK TODAY: every read in src/server names its tenant
-- in a WHERE clause, and `audit:tenancy --strict` asserts it — 0 unkeyed
-- reads. So the app was protected by its own discipline and NOT by RLS,
-- which is precisely the backstop RLS exists to be. One forgotten
-- `and restaurant_id = …` and this becomes live.

begin;

alter view public.advances_outstanding        set (security_invoker = on);
alter view public.attendance_current          set (security_invoker = on);
alter view public.attendance_summary          set (security_invoker = on);
alter view public.business_day_disagreements  set (security_invoker = on);
alter view public.day_summary                 set (security_invoker = on);
alter view public.headcount_by_section        set (security_invoker = on);
alter view public.labour_cost_daily           set (security_invoker = on);
alter view public.labour_hours_by_section     set (security_invoker = on);
alter view public.labour_summary              set (security_invoker = on);
alter view public.mapping_coverage            set (security_invoker = on);
alter view public.sales_by_hour               set (security_invoker = on);
alter view public.sales_by_section            set (security_invoker = on);
alter view public.sales_current               set (security_invoker = on);
alter view public.sales_per_labour_hour       set (security_invoker = on);
alter view public.section_frequent_items      set (security_invoker = on);
alter view public.slow_moving_stock           set (security_invoker = on);
alter view public.staff_payroll_history       set (security_invoker = on);
alter view public.unmapped_pos_items          set (security_invoker = on);
alter view public.vendor_dues                 set (security_invoker = on);
alter view public.vendor_performance          set (security_invoker = on);
alter view public.vendor_return_reasons       set (security_invoker = on);
alter view public.vendor_supplied_items       set (security_invoker = on);

commit;

-- AFTER APPLYING, `npm run audit:tenancy -- --strict` turns green: it now
-- asserts every view in the schema carries the option, which is the check
-- that was missing. It walked 65 TABLES and never once looked at a view.
