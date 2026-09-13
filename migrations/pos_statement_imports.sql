-- Immutable provider statement evidence for POS reconciliation.
begin;
create table if not exists public.pos_statement_imports (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
  provider text not null default 'Petpooja', imported_by text, imported_at timestamptz not null default now(),
  note text, unique (restaurant_id, id)
);
create table if not exists public.pos_statement_lines (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
  import_id uuid not null, business_date date not null, pos_order_id text, amount numeric(14,2) not null,
  payment_mode text, status text, unique (restaurant_id, id),
  foreign key (restaurant_id, import_id) references public.pos_statement_imports (restaurant_id, id)
);
alter table public.pos_statement_imports enable row level security; alter table public.pos_statement_imports force row level security;
drop policy if exists tenant_isolation on public.pos_statement_imports; create policy tenant_isolation on public.pos_statement_imports using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
alter table public.pos_statement_lines enable row level security; alter table public.pos_statement_lines force row level security;
drop policy if exists tenant_isolation on public.pos_statement_lines; create policy tenant_isolation on public.pos_statement_lines using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
create index if not exists pos_statement_lines_date on public.pos_statement_lines (restaurant_id, business_date, import_id);
revoke all on public.pos_statement_imports, public.pos_statement_lines from kb_app;
grant select, insert on public.pos_statement_imports, public.pos_statement_lines to kb_app;
commit;
