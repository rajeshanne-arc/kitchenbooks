-- merge_recipes_and_discardable_masters
--
-- WRITTEN, NOT APPLIED. kb_app holds no DDL; every migration in this project
-- is authored, named and applied by Rajesh.
--
-- Extends discard and merge past items and vendors. Two separate problems:
--
--   1. FIVE MASTERS CANNOT BE DISCARDED AT ALL TODAY. recipes, money_accounts,
--      meters, storage_locations and list_options each carry
--      status CHECK (active|inactive), so writing 'discarded' violates the
--      constraint. The app's discard path is complete and simply refused.
--
--   2. A RECIPE MERGE IS NOT AN ITEM MERGE. It needs its own function, and the
--      reason is below — it is not a matter of different guards, it is that
--      the repoint set itself is selective.

begin;

-- ─── 1 · the four words, on the masters that were only ever offered two ────
--
-- Retired means we stopped using it. Discarded means it was never real.
-- Merged means look over there. `merged_into` is the pointer that keeps a
-- closed code RESOLVABLE, which is the whole reason closing one is safe.
--
-- COMPOSITE FOREIGN KEY on every one, like all 99 others in this schema: a
-- single-column FK runs as the table owner, so RLS never filters it and a
-- uuid from another restaurant satisfies it perfectly.

alter table recipes            drop constraint recipes_status_check;
alter table recipes            add constraint recipes_status_check
  check (status = any (array['active','inactive','merged','discarded']));
alter table recipes            add column merged_into uuid;
alter table recipes            add constraint recipes_merged_into_fk
  foreign key (restaurant_id, merged_into) references recipes(restaurant_id, id);

alter table money_accounts     drop constraint money_accounts_status_check;
alter table money_accounts     add constraint money_accounts_status_check
  check (status = any (array['active','inactive','merged','discarded']));
alter table money_accounts     add column merged_into uuid;
alter table money_accounts     add constraint money_accounts_merged_into_fk
  foreign key (restaurant_id, merged_into) references money_accounts(restaurant_id, id);

alter table meters             drop constraint meters_status_check;
alter table meters             add constraint meters_status_check
  check (status = any (array['active','inactive','merged','discarded']));
alter table meters             add column merged_into uuid;
alter table meters             add constraint meters_merged_into_fk
  foreign key (restaurant_id, merged_into) references meters(restaurant_id, id);

alter table storage_locations  drop constraint storage_locations_status_check;
alter table storage_locations  add constraint storage_locations_status_check
  check (status = any (array['active','inactive','merged','discarded']));
alter table storage_locations  add column merged_into uuid;
alter table storage_locations  add constraint storage_locations_merged_into_fk
  foreign key (restaurant_id, merged_into) references storage_locations(restaurant_id, id);

alter table list_options       drop constraint list_options_status_check;
alter table list_options       add constraint list_options_status_check
  check (status = any (array['active','inactive','merged','discarded']));
alter table list_options       add column merged_into uuid;
alter table list_options       add constraint list_options_merged_into_fk
  foreign key (restaurant_id, merged_into) references list_options(restaurant_id, id);

grant update (merged_into) on recipes, money_accounts, meters, storage_locations, list_options to kb_app;

-- ─── 2 · merge_recipes, and why it could not be merge_items ────────────────
--
-- merge_items repoints EVERY foreign key that points at items, because an
-- item is only ever referenced as a subject. Nine columns point at recipes and
-- TWO OF THEM MUST NOT MOVE:
--
--   recipe_lines.recipe_id       — the OWNER of a line. Repointing it would
--                                  drag the closed recipe's ingredients into
--                                  the survivor's card, which already has a
--                                  complete one. The result is a card holding
--                                  every ingredient twice. The survivor's card
--                                  is the surviving definition; the closed
--                                  recipe keeps its own lines, which nothing
--                                  reads once it is merged.
--
--   dish_cost_snapshots.recipe_id — a PHOTOGRAPH. "Live costs rewrite history,
--                                  photographs don't." The snapshot recorded
--                                  what that recipe cost on that day, and that
--                                  recipe existed on that day. Repointing it
--                                  would rewrite what a photograph said.
--
-- Everything else moves: pos_item_map, productions, kitchen_closing_lines,
-- kitchen_wastage, non_revenue, off_book_lines, and recipe_lines
-- .component_recipe_id — other cards that used the closed recipe as a SUB now
-- use the survivor.
--
-- That selectivity is why this is a hand-written list rather than the
-- pg_constraint loop merge_items uses. A generic loop would be wrong here, and
-- wrong quietly.

create or replace function public.merge_recipes(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tenant uuid := current_setting('app.restaurant_id', true)::uuid;
  f record; t record; cnt bigint; moved jsonb := '{}'::jsonb;
  -- the repoint set, stated rather than discovered: see the note above
  targets text[][] := array[
    ['pos_item_map','recipe_id'],
    ['productions','recipe_id'],
    ['kitchen_closing_lines','component_recipe_id'],
    ['kitchen_wastage','recipe_id'],
    ['non_revenue','recipe_id'],
    ['off_book_lines','recipe_id'],
    ['recipe_lines','component_recipe_id']
  ];
  i int;
begin
  if tenant is null then raise exception 'no tenant announced'; end if;
  if p_from = p_to then raise exception 'a recipe cannot be merged into itself'; end if;

  select * into f from recipes where id = p_from and restaurant_id = tenant for update;
  select * into t from recipes where id = p_to   and restaurant_id = tenant for update;
  if f.id is null then raise exception 'the recipe being closed does not exist here'; end if;
  if t.id is null then raise exception 'the surviving recipe does not exist here'; end if;
  if t.status <> 'active' then
    raise exception 'the surviving recipe % is not active', t.code; end if;

  -- KIND IS THE UNITS RULE OF THIS TABLE, and it is the load-bearing guard.
  -- A dish and a sub are costed on different scales: productions freezes
  -- unit_cost from dish_costs.cost_per_portion for a dish and from
  -- recipe_costs.cost_per_output_unit for a sub, and a sub's output IS its
  -- batch yield where a dish's output_qty means PORTIONS MADE. Merging across
  -- kinds silently reinterprets every frozen cost that moves.
  if f.kind <> t.kind then
    raise exception 'a % cannot be merged into a %: % is a %, but % is a %',
      f.kind, t.kind, f.code, f.kind, t.code, t.kind; end if;

  -- OUTPUT UNIT, for subs. recipe_lines.qty on a sub component is expressed in
  -- that sub's output_unit, so merging a sub measured in litres into one
  -- measured in kilos corrupts every quantity that points at it — the item
  -- units rule exactly, one level up.
  if f.kind = 'sub' and f.output_unit <> t.output_unit then
    raise exception 'output units differ: % is in %, but % is in %',
      f.code, f.output_unit, t.code, t.output_unit; end if;

  -- A CARD HOLDING BOTH AS COMPONENTS would end up with two lines of one
  -- ingredient and no way to tell which quantity was meant. The item rule,
  -- unchanged.
  if exists (
    select 1 from recipe_lines a
    join recipe_lines b on b.recipe_id = a.recipe_id
    where a.component_recipe_id = p_from and b.component_recipe_id = p_to
  ) then
    raise exception 'a recipe uses both % and % — remove one line first', f.code, t.code; end if;

  if exists (
    select 1 from pos_item_map a
    join pos_item_map b on b.pos_item_id = a.pos_item_id
    where a.recipe_id = p_from and b.recipe_id = p_to
  ) then
    raise exception 'a POS item maps to both % and %', f.code, t.code; end if;

  -- THE GUARD WITH NO ITEM ANALOGUE AT ALL: THE CYCLE.
  --
  -- The app already refuses to INSERT a component that would close a loop.
  -- A merge can create one that no single insert ever could: if the survivor
  -- contains the closing recipe — at any depth — then merging makes the
  -- survivor contain itself, and recipe_costs recurses until its depth cap
  -- saves it and reports a cost nobody can explain.
  --
  -- Depth-capped at 12 to match recipe_costs: the cap is blast-radius control,
  -- and the guard is this walk.
  if exists (
    with recursive down as (
      select component_recipe_id as id, 1 as depth
      from recipe_lines
      where recipe_id = p_to and component_recipe_id is not null
      union all
      select rl.component_recipe_id, d.depth + 1
      from recipe_lines rl
      join down d on rl.recipe_id = d.id
      where rl.component_recipe_id is not null and d.depth < 12
    )
    select 1 from down where id = p_from
  ) then
    raise exception '% already contains % — merging them would make it contain itself', t.code, f.code;
  end if;

  for i in 1 .. array_length(targets, 1) loop
    execute format('update public.%I set %I = $1 where %I = $2',
                   targets[i][1], targets[i][2], targets[i][2])
      using p_to, p_from;
    get diagnostics cnt = row_count;
    if cnt > 0 then moved := moved || jsonb_build_object(targets[i][1] || '.' || targets[i][2], cnt); end if;
  end loop;

  update recipes set status = 'merged', merged_into = p_to where id = p_from;

  return jsonb_build_object('from', f.code, 'to', t.code, 'moved', moved);
end $function$;

-- EXECUTE TO kb_app ALONE. On Supabase a function is granted to PUBLIC on
-- creation AND explicitly to anon / authenticated / service_role by default,
-- and an explicit grant survives a revoke from PUBLIC — so all four are named.
revoke all on function public.merge_recipes(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.merge_recipes(uuid, uuid) to kb_app;

commit;

-- AFTER APPLYING, read back rather than trusting the exit status:
--   select proname, proacl from pg_proc where proname = 'merge_recipes';
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'recipes'::regclass and conname like '%status%';
-- A statement that succeeds is not a statement that did something.
