// Read side of recipes. Costs are LIVE — recipe_costs / dish_costs compute
// from item_costs at read time and are never stored. Per-line costs join the
// same named views server-side; nothing money-shaped is computed client-side.
import 'server-only'
import { sql } from '@/lib/db'
import type {
  ComponentHit,
  DishCard,
  DishCostRow,
  RecipeDetail,
  RecipeLineRow,
  SubCostRow,
} from '@/lib/types'

export async function listDishCosts(restaurantId: string): Promise<DishCostRow[]> {
  return sql<DishCostRow[]>`
    select dc.recipe_id, dc.code, dc.name, dc.section_code, dc.section_name,
           s.sort_order as section_sort,
           dc.dish_cost::text as dish_cost,
           dc.selling_price::text as selling_price,
           dc.food_cost_pct::text as food_cost_pct,
           dc.uncosted_lines::int as uncosted_lines,
           dc.status
    from dish_costs dc
    join sections s on s.restaurant_id = dc.restaurant_id and s.code = dc.section_code
    where dc.restaurant_id = ${restaurantId}
    order by s.sort_order asc, dc.code asc`
}

export async function listSubCosts(restaurantId: string): Promise<SubCostRow[]> {
  return sql<SubCostRow[]>`
    select rc.recipe_id, rc.code, rc.name,
           rc.output_qty::text as output_qty, rc.output_unit,
           rc.total_cost::text as total_cost,
           rc.cost_per_output_unit::text as cost_per_output_unit,
           rc.uncosted_lines::int as uncosted_lines,
           r.status
    from recipe_costs rc
    join recipes r on r.id = rc.recipe_id
    where rc.restaurant_id = ${restaurantId} and rc.kind = 'sub'
    order by rc.code asc`
}

export async function getRecipeDetail(restaurantId: string, id: string): Promise<RecipeDetail | null> {
  const rows = await sql<RecipeDetail[]>`
    select r.id, r.code, r.name, r.kind, r.section_id,
           s.code as section_code, s.name as section_name,
           r.output_qty::text as output_qty, r.output_unit, u.name as output_unit_name,
           r.selling_price::text as selling_price, r.status, r.created_at::text as created_at,
           rc.total_cost::text as total_cost,
           rc.cost_per_output_unit::text as cost_per_output_unit,
           rc.uncosted_lines::int as uncosted_lines,
           dc.food_cost_pct::text as food_cost_pct
    from recipes r
    join units u on u.code = r.output_unit
    left join sections s on s.id = r.section_id
    left join recipe_costs rc on rc.recipe_id = r.id
    left join dish_costs dc on dc.recipe_id = r.id
    where r.restaurant_id = ${restaurantId} and r.id = ${id}`
  return rows[0] ?? null
}

export async function getRecipeLines(recipeId: string): Promise<RecipeLineRow[]> {
  return sql<RecipeLineRow[]>`
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
  const items = await sql<Omit<Extract<ComponentHit, { kind: 'item' }>, 'kind'>[]>`
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
  const subs = await sql<Omit<Extract<ComponentHit, { kind: 'sub' }>, 'kind'>[]>`
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
  const rows = await sql<DishCard[]>`
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
  return sql<{ course: string; target_pct: string }[]>`
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
  const rows = await sql<{ photo_url: string | null; video_url: string | null }[]>`
    select photo_url, video_url from recipes
    where restaurant_id = ${restaurantId} and id = ${recipeId}`
  return rows[0] ?? { photo_url: null, video_url: null }
}
