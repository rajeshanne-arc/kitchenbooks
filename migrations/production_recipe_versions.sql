-- Pin every production record to the immutable recipe version effective on its
-- production date. Existing records are backfilled to the best available
-- version; no historical version is invented before recipe history existed.
begin;

alter table public.productions add column if not exists recipe_version_id uuid;

update public.productions p
set recipe_version_id = (
  select rv.id
  from public.recipe_versions rv
  where rv.restaurant_id = p.restaurant_id
    and rv.recipe_id = p.recipe_id
    and rv.effective_from::date <= p.prod_date
  order by rv.effective_from desc, rv.version_no desc
  limit 1
)
where p.recipe_version_id is null
  and exists (
    select 1
    from public.recipe_versions rv
    where rv.restaurant_id = p.restaurant_id
      and rv.recipe_id = p.recipe_id
      and rv.effective_from::date <= p.prod_date
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'productions_recipe_version_fk'
      and conrelid = 'public.productions'::regclass
  ) then
    alter table public.productions
      add constraint productions_recipe_version_fk
      foreign key (restaurant_id, recipe_version_id)
      references public.recipe_versions (restaurant_id, id);
  end if;
end $$;

create index if not exists productions_recipe_version
  on public.productions (restaurant_id, recipe_version_id);

grant select, insert on public.productions to kb_app;
commit;
