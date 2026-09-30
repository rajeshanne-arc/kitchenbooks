-- Immutable recipe history with effective dates.
-- The live recipes/recipe_lines tables remain the editing surface for the
-- first rollout; every successful application write also records the full
-- card and its component lines here before another version can supersede it.

begin;

create table if not exists public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  recipe_id uuid not null,
  version_no integer not null check (version_no > 0),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  snapshot jsonb not null,
  recorded_by text,
  recorded_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, recipe_id, version_no),
  foreign key (restaurant_id, recipe_id)
    references public.recipes (restaurant_id, id)
);

create unique index if not exists recipe_versions_one_current
  on public.recipe_versions (restaurant_id, recipe_id)
  where effective_to is null;

alter table public.recipe_versions enable row level security;
alter table public.recipe_versions force row level security;
drop policy if exists tenant_isolation on public.recipe_versions;
create policy tenant_isolation on public.recipe_versions
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

grant select, insert, update on public.recipe_versions to kb_app;

-- Existing cards receive version 1 at their creation timestamp. This is a
-- one-time photograph, not a claim that edits before this migration can be
-- reconstructed.
insert into public.recipe_versions
  (restaurant_id, recipe_id, version_no, effective_from, snapshot, recorded_by)
select r.restaurant_id, r.id, 1, r.created_at,
       jsonb_build_object(
         'recipe', to_jsonb(r),
         'lines', coalesce(jsonb_agg(to_jsonb(l) order by l.id) filter (where l.id is not null), '[]'::jsonb)
       ),
       'migration'
from public.recipes r
left join public.recipe_lines l
  on l.restaurant_id = r.restaurant_id and l.recipe_id = r.id
where not exists (
  select 1 from public.recipe_versions v
  where v.restaurant_id = r.restaurant_id and v.recipe_id = r.id
)
group by r.restaurant_id, r.id, r.created_at;

commit;
