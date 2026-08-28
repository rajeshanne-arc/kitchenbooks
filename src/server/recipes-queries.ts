// Read side of recipes. Costs are LIVE — recipe_costs / dish_costs compute
// from item_costs at read time and are never stored. Per-line costs join the
// same named views server-side; nothing money-shaped is computed client-side.
import 'server-only'
import { sql, tsql } from '@/lib/db'
import type {
  ComponentHit,
  DishCard,
  DishCostRow,
  RecipeDetail,
  RecipeLineRow,
  SubCostRow,
  SupplierExposureRow,
  ProducibleRow,
} from '@/lib/types'

/** Ordered by SECTION (the department a chef works in) or by FOOD COST
 *  (what is expensive, wherever it lives). Two real questions over one list:
 *  "what is in Chinese" and "what is expensive" almost never have the same
 *  answer, and a section grouping hides the second entirely.
 *
 *  Uncosted dishes sort LAST under by-food-cost rather than first: a dish
 *  costing zero is a broken link, not a cheap dish, and putting it at the top
 *  of "most expensive" would read as the opposite of what it is. */
export async function listDishCosts(
  restaurantId: string,
  order: 'by-section' | 'by-food-cost' = 'by-section',
): Promise<DishCostRow[]> {
  return tsql<DishCostRow[]>`
    select dc.recipe_id, dc.code, dc.name, dc.section_code, dc.section_name,
           s.sort_order as section_sort,
           dc.dish_cost::text as dish_cost,
           dc.selling_price::text as selling_price,
           dc.food_cost_pct::text as food_cost_pct,
           dc.uncosted_lines::int as uncosted_lines,
           dc.status,
           -- WIDENED rather than cloned. The department page needs the course,
           -- the portions and the target the flag is set against; adding five
           -- columns here is smaller than a second reader of the same view,
           -- and the repo punishes duplicate readers.
           dc.course,
           dc.portions::text as portions,
           dc.cost_per_portion::text as cost_per_portion,
           dc.target_pct::text as target_pct,
           dc.flag
    from dish_costs dc
    join sections s on s.restaurant_id = dc.restaurant_id and s.code = dc.section_code
    join recipes dr on dr.restaurant_id = dc.restaurant_id and dr.id = dc.recipe_id
    where dc.restaurant_id = ${restaurantId}
      -- ARCHIVED, NOT DELETED — see src/lib/closed.ts. A merged or discarded
      -- card leaves the browsing list; a retired one stays, marked.
      and dr.status not in ('merged', 'discarded')
    order by ${
      order === 'by-food-cost'
        ? sql`(dc.uncosted_lines > 0) asc, dc.food_cost_pct desc nulls last,`
        : sql`s.sort_order asc,`
    } dc.code asc`
}

export async function listSubCosts(restaurantId: string): Promise<SubCostRow[]> {
  return tsql<SubCostRow[]>`
    select rc.recipe_id, rc.code, rc.name,
           rc.output_qty::text as output_qty, rc.output_unit,
           rc.total_cost::text as total_cost,
           rc.cost_per_output_unit::text as cost_per_output_unit,
           rc.uncosted_lines::int as uncosted_lines,
           r.status
    from recipe_costs rc
    join recipes r on r.id = rc.recipe_id
    where rc.restaurant_id = ${restaurantId} and rc.kind = 'sub'
      -- ARCHIVED, NOT DELETED — see src/lib/closed.ts. A merged or discarded
      -- card leaves the browsing list; a retired one stays, marked.
      and r.status not in ('merged', 'discarded')
    order by rc.code asc`
}

/**
 * Everything the kitchen can record MAKING, subs and dishes together.
 *
 * The two are deliberately DIFFERENT in what a quantity means, and the picker
 * must keep them visibly apart: a sub is made in its batch unit (litres of
 * gravy), a dish is made in PORTIONS. Conflating them is how a batch cost
 * silently becomes a portion cost.
 *
 * So each row carries the cost of ONE OUTPUT UNIT on its own terms —
 * `cost_per_output_unit` for a sub, `cost_per_portion` for a dish — and the
 * unit label to show beside the quantity.
 */
export async function listProducibles(restaurantId: string): Promise<ProducibleRow[]> {
  return tsql<ProducibleRow[]>`
    select rc.recipe_id, 'sub' as kind, rc.code, rc.name,
           rc.output_unit as unit_name,
           rc.cost_per_output_unit::text as unit_cost,
           null::text as portions,
           rc.uncosted_lines::int as uncosted_lines
    from recipe_costs rc
    join recipes r on r.id = rc.recipe_id
    where rc.restaurant_id = ${restaurantId} and rc.kind = 'sub' and r.status = 'active'
    union all
    select dc.recipe_id, 'dish' as kind, dc.code, dc.name,
           'portion' as unit_name,
           dc.cost_per_portion::text as unit_cost,
           dc.portions::text as portions,
           dc.uncosted_lines::int as uncosted_lines
    from dish_costs dc
    where dc.restaurant_id = ${restaurantId} and dc.status = 'active'
    order by kind desc, code asc`
}

export async function getRecipeDetail(restaurantId: string, id: string): Promise<RecipeDetail | null> {
  const rows = await tsql<RecipeDetail[]>`
    select r.id, r.code, r.name, r.kind, r.section_id,
           s.code as section_code, s.name as section_name,
           r.output_qty::text as output_qty, r.output_unit, u.name as output_unit_name,
           r.selling_price::text as selling_price, r.status, r.created_at::text as created_at,
           rc.total_cost::text as total_cost,
           rc.cost_per_output_unit::text as cost_per_output_unit,
           rc.uncosted_lines::int as uncosted_lines,
           dc.food_cost_pct::text as food_cost_pct,
           -- A CLOSED CARD STAYS RESOLVABLE, the same as an item's.
           r.merged_into, mr.code as merged_into_code, mr.name as merged_into_name
    from recipes r
    join units u on u.code = r.output_unit
    left join recipes mr on mr.restaurant_id = r.restaurant_id and mr.id = r.merged_into
    left join sections s on s.id = r.section_id
    left join recipe_costs rc on rc.recipe_id = r.id
    left join dish_costs dc on dc.recipe_id = r.id
    where r.restaurant_id = ${restaurantId} and r.id = ${id}`
  return rows[0] ?? null
}

export async function getRecipeLines(recipeId: string): Promise<RecipeLineRow[]> {
  return tsql<RecipeLineRow[]>`
    select rl.id, rl.component_item_id, rl.component_recipe_id,
           coalesce(i.code, sr.code) as component_code,
           coalesce(i.name, sr.name) as component_name,
           (rl.component_recipe_id is not null) as is_sub,
           rl.qty::text as qty,
           rl.yield_pct::text as yield_pct,
           case when rl.component_item_id is not null then i.purchase_unit else sr.output_unit end as unit,
           case when rl.component_item_id is not null then ic.issue_cost
                else src.cost_per_output_unit end::text as unit_cost,
           -- cost per USABLE unit, and the line value that follows from it.
           -- Same arithmetic recipe_costs uses, so the lines add up to the
           -- batch total the view states rather than to a different number.
           (case when rl.component_item_id is not null then ic.issue_cost
                 else src.cost_per_output_unit end
            / nullif(rl.yield_pct, 0) * 100)::text as usable_cost,
           (rl.qty * coalesce(
              case when rl.component_item_id is not null then ic.issue_cost
                   else src.cost_per_output_unit end, 0)
            / nullif(rl.yield_pct, 0) * 100)::text as line_cost,
           (rl.component_item_id is not null and ic.issue_cost is null) as uncosted,
           coalesce(src.uncosted_lines, 0)::int as sub_uncosted_lines
    from recipe_lines rl
    left join items i on i.id = rl.component_item_id
    left join item_costs ic on ic.item_id = rl.component_item_id
    left join recipes sr on sr.id = rl.component_recipe_id
    left join recipe_costs src on src.recipe_id = rl.component_recipe_id
    where rl.recipe_id = ${recipeId}
    order by coalesce(i.name, sr.name) asc, rl.id asc`
}

/** Typeahead over items ∪ existing sub-recipes for the lines editor */
export async function searchComponents(
  restaurantId: string,
  q: string,
  excludeRecipeId: string | null,
): Promise<ComponentHit[]> {
  const like = `%${q}%`
  const prefix = `${q}%`
  const items = await tsql<Omit<Extract<ComponentHit, { kind: 'item' }>, 'kind'>[]>`
    select i.id, i.code, i.name, c.name as category_name, i.purchase_unit, u.name as unit_name,
           (ic.issue_cost is not null) as has_cost
    from items i
    join categories c on c.code = i.category
    join units u on u.code = i.purchase_unit
    left join item_costs ic on ic.item_id = i.id
    where i.restaurant_id = ${restaurantId} and i.status = 'active'
      and (i.name ilike ${like} or i.code ilike ${like})
    order by (i.name ilike ${prefix}) desc, i.name asc
    limit 8`
  const subs = await tsql<Omit<Extract<ComponentHit, { kind: 'sub' }>, 'kind'>[]>`
    select r.id, r.code, r.name, r.output_unit, u.name as unit_name
    from recipes r
    join units u on u.code = r.output_unit
    where r.restaurant_id = ${restaurantId} and r.kind = 'sub' and r.status = 'active'
      and r.id is distinct from ${excludeRecipeId}
      and (r.name ilike ${like} or r.code ilike ${like})
    order by (r.name ilike ${prefix}) desc, r.name asc
    limit 6`
  return [
    ...items.map((r) => ({ kind: 'item' as const, ...r })),
    ...subs.map((r) => ({ kind: 'sub' as const, ...r })),
  ]
}

/** One dish card, straight from dish_costs. Nothing here is recomputed:
 *  cost per portion, loaded cost, food cost %, margin, the course target
 *  and the flag are all the view's own arithmetic. */
export async function getDishCard(restaurantId: string, recipeId: string): Promise<DishCard | null> {
  const rows = await tsql<DishCard[]>`
    select recipe_id, code, name, section_code, section_name,
           pos_code, course, diet,
           dish_cost::text as dish_cost,
           portions::text as portions,
           portion_size::text as portion_size,
           portion_unit,
           overhead_pct::text as overhead_pct,
           cost_per_portion::text as cost_per_portion,
           loaded_per_portion::text as loaded_per_portion,
           selling_price::text as selling_price,
           food_cost_pct::text as food_cost_pct,
           margin_per_portion::text as margin_per_portion,
           target_pct::text as target_pct,
           flag,
           coalesce(uncosted_lines, 0)::int as uncosted_lines,
           status
    from dish_costs
    where restaurant_id = ${restaurantId} and recipe_id = ${recipeId}`
  return rows[0] ?? null
}

/** The courses an owner has set targets for — the card's course picker. */
export async function listCourses(restaurantId: string): Promise<{ course: string; target_pct: string }[]> {
  return tsql<{ course: string; target_pct: string }[]>`
    select course, target_pct::text as target_pct
    from course_targets
    where restaurant_id = ${restaurantId} and course <> 'DEFAULT'
    order by sort_order asc`
}

/** The photo and video links, which dish_costs does not carry. */
export async function getRecipeMedia(
  restaurantId: string,
  recipeId: string,
): Promise<{ photo_url: string | null; video_url: string | null }> {
  const rows = await tsql<{ photo_url: string | null; video_url: string | null }[]>`
    select photo_url, video_url from recipes
    where restaurant_id = ${restaurantId} and id = ${recipeId}`
  return rows[0] ?? { photo_url: null, video_url: null }
}

/** Menu exposure by supplier, from supplier_costs.
 *
 * SORTED BY DISHES, NOT MONEY, and that ordering is the report's argument:
 * a supplier behind 30 dishes is a harder problem than a bigger number
 * behind 2. If the big-money supplier fails you pay more; if the 30-dish
 * supplier fails, a third of the menu stops.
 *
 * Sub-recipe lines are already split across the suppliers inside them by
 * the view — a gravy made of four suppliers' ingredients exposes all four.
 */
export async function getSupplierExposure(restaurantId: string): Promise<SupplierExposureRow[]> {
  return tsql<SupplierExposureRow[]>`
    select supplier, items::int as items, dishes::int as dishes, batch_cost::text as batch_cost
    from supplier_costs
    where restaurant_id = ${restaurantId}
    order by dishes desc, batch_cost desc, supplier asc`
}
