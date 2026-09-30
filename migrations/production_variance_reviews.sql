-- Review metadata for production variance. This never edits production rows;
-- it records what the manager/owner decided about the exception.
begin;
create table if not exists public.production_variance_reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  recipe_id uuid not null,
  month_start date not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'correction_requested')),
  note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, recipe_id, month_start),
  foreign key (restaurant_id, recipe_id) references public.recipes (restaurant_id, id)
);
alter table public.production_variance_reviews enable row level security;
alter table public.production_variance_reviews force row level security;
drop policy if exists tenant_isolation on public.production_variance_reviews;
create policy tenant_isolation on public.production_variance_reviews using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid) with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
grant select, insert, update on public.production_variance_reviews to kb_app;
commit;
