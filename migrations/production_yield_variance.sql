-- Snapshot expected yield and measured waste on every production filing.
-- Existing rows remain valid; new filings record the variance inputs explicitly.
begin;
alter table public.productions
  add column if not exists expected_output_qty numeric(14,3),
  add column if not exists waste_qty numeric(14,3) not null default 0
    check (waste_qty >= 0);
create index if not exists productions_yield_variance
  on public.productions (restaurant_id, prod_date desc, recipe_id);
grant insert (expected_output_qty, waste_qty) on public.productions to kb_app;
commit;
