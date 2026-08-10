// Read side of the kitchen truth. Closings are VALUE per section — onions
// became gravy; value survives transformation, quantity does not — and the
// latest row per (section, date) wins (kitchen_closing_current). Food cost
// comes from section_food_cost, which only states consumed_total once the
// month HAS an ending closing; before that it is NULL and the page says
// "pending closing" — never fill it in code.
import 'server-only'
import { sql } from '@/lib/db'
import type { ClosingChecklistRow, ClosingRow, FoodCostRow, KitchenWastageRow, Section } from '@/lib/types'

/** The stock-holding sections a chef closes: Kitchen and Bar org units. */
export async function getKitchenSections(restaurantId: string): Promise<Section[]> {
  return sql<Section[]>`
    select id, code, name, sort_order, status, dept_group
    from sections
    where restaurant_id = ${restaurantId} and status = 'active'
      and dept_group in ('Kitchen', 'Bar')
    order by sort_order asc`
}

/** One row per kitchen section for a date: today's effective closing (or
 * null), with the filing count so corrections wear their marker. */
export async function getClosingChecklist(restaurantId: string, date: string): Promise<ClosingChecklistRow[]> {
  return sql<ClosingChecklistRow[]>`
    select s.id as section_id, s.code, s.name,
           c.closing_value::text as closing_value,
           coalesce(f.n, 0)::int as filings,
           c.entered_by
    from sections s
    left join kitchen_closing_current c
      on c.section_id = s.id and c.close_date = ${date}::date
    left join lateral (
      select count(*)::int as n from kitchen_closings k
      where k.section_id = s.id and k.close_date = ${date}::date
    ) f on true
    where s.restaurant_id = ${restaurantId} and s.status = 'active'
      and s.dept_group in ('Kitchen', 'Bar')
    order by s.sort_order asc`
}

export async function getClosingCurrent(
  restaurantId: string,
  sectionId: string,
  date: string,
): Promise<ClosingRow | null> {
  const rows = await sql<ClosingRow[]>`
    select c.id, c.section_id, s.code as section_code, s.name as section_name,
           c.close_date::text as close_date, c.closing_value::text as closing_value,
           c.note, c.entered_by, c.created_at::text as created_at,
           (select count(*)::int from kitchen_closings k
            where k.section_id = c.section_id and k.close_date = c.close_date) as filings
    from kitchen_closing_current c
    join sections s on s.id = c.section_id
    where c.restaurant_id = ${restaurantId} and c.section_id = ${sectionId} and c.close_date = ${date}::date`
  return rows[0] ?? null
}

const KW_SELECT = `
  select w.id, w.waste_date::text as waste_date, w.section_id,
         s.code as section_code, s.name as section_name,
         w.item_id, i.name as item_name, i.purchase_unit,
         w.qty::text as qty, w.value::text as value, w.reason, w.note,
         w.reverses_id,
         (w.reverses_id is not null) as is_reversal,
         exists (select 1 from kitchen_wastage r where r.reverses_id = w.id) as is_voided,
         w.entered_by, w.created_at::text as created_at
  from kitchen_wastage w
  join sections s on s.id = w.section_id
  left join items i on i.id = w.item_id`

export async function getKitchenWastageById(restaurantId: string, id: string): Promise<KitchenWastageRow | null> {
  const rows = await sql<KitchenWastageRow[]>`
    ${sql.unsafe(KW_SELECT)}
    where w.restaurant_id = ${restaurantId} and w.id = ${id}`
  return rows[0] ?? null
}

export async function listKitchenWastage(restaurantId: string, limit = 40): Promise<KitchenWastageRow[]> {
  return sql<KitchenWastageRow[]>`
    ${sql.unsafe(KW_SELECT)}
    where w.restaurant_id = ${restaurantId}
    order by w.waste_date desc, w.created_at desc
    limit ${limit}`
}

/** Food cost for one month. Sections with no issues that month have no
 * section_consumption row and therefore no view row — they are listed with
 * nulls so the page can say "no issues this month" instead of hiding them. */
export async function getFoodCost(restaurantId: string, monthStart: string): Promise<FoodCostRow[]> {
  return sql<FoodCostRow[]>`
    select s.code as section_code, s.name as section_name,
           (f.section_code is not null) as has_activity,
           coalesce(f.opening_value, 0)::text as opening_value,
           coalesce(f.issued_value, 0)::text as issued_value,
           f.ending_value::text as ending_value,
           coalesce(f.kitchen_wastage, 0)::text as kitchen_wastage,
           f.consumed_total::text as consumed_total,
           f.sales_value::text as sales_value,
           f.food_cost_pct::text as food_cost_pct
    from sections s
    left join section_food_cost f
      on f.restaurant_id = s.restaurant_id and f.section_code = s.code and f.month = ${monthStart}::date
    where s.restaurant_id = ${restaurantId} and s.status = 'active'
      and s.dept_group in ('Kitchen', 'Bar')
    order by s.sort_order asc`
}
