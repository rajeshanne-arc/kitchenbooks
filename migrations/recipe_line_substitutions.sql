-- Approved alternatives for a specific ingredient line. A substitution is
-- not a silent recipe edit: the primary line stays intact and the chef records
-- what may replace it, at what quantity ratio, and why.
begin;
-- `recipe_lines.id` is globally primary-keyed in the base schema, but every
-- tenant child must reference the tenant-qualified key. PostgreSQL requires
-- the referenced column pair to be unique, so provide that invariant before
-- adding the composite foreign keys below.
create unique index if not exists recipe_lines_restaurant_id_id
  on public.recipe_lines (restaurant_id, id);

create table if not exists public.recipe_line_substitutions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  recipe_line_id uuid not null,
  substitute_item_id uuid not null,
  quantity_ratio numeric(10,4) not null check (quantity_ratio > 0),
  note text,
  entered_by text not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, recipe_line_id, substitute_item_id),
  foreign key (restaurant_id, recipe_line_id) references public.recipe_lines (restaurant_id, id),
  foreign key (restaurant_id, substitute_item_id) references public.items (restaurant_id, id)
);
create index if not exists recipe_line_substitutions_line on public.recipe_line_substitutions (restaurant_id, recipe_line_id);
alter table public.recipe_line_substitutions enable row level security;
alter table public.recipe_line_substitutions force row level security;
drop policy if exists tenant_isolation on public.recipe_line_substitutions;
create policy tenant_isolation on public.recipe_line_substitutions
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);
grant select, insert, delete on public.recipe_line_substitutions to kb_app;
commit;
