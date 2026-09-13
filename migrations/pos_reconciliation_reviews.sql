-- Review decision for a provider/book difference. It never edits either
-- source; corrections remain separate POS generations or approved entries.
begin;
create table if not exists public.pos_reconciliation_reviews (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
  import_id uuid not null, business_date date not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'correction_requested')),
  note text not null, reviewed_by text not null, reviewed_at timestamptz not null default now(), created_at timestamptz not null default now(),
  unique (restaurant_id, id), unique (restaurant_id, import_id, business_date),
  foreign key (restaurant_id, import_id) references public.pos_statement_imports (restaurant_id, id)
);
alter table public.pos_reconciliation_reviews enable row level security; alter table public.pos_reconciliation_reviews force row level security;
drop policy if exists tenant_isolation on public.pos_reconciliation_reviews;
create policy tenant_isolation on public.pos_reconciliation_reviews using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
grant select, insert, update on public.pos_reconciliation_reviews to kb_app;
commit;
