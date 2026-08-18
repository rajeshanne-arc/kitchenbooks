// Read side of the kitchen truth. Closings are VALUE per section — onions
// became gravy; value survives transformation, quantity does not — and the
// latest row per (section, date) wins (kitchen_closing_current). Food cost
// comes from section_food_cost, which only states consumed_total once the
// month HAS an ending closing; before that it is NULL and the page says
// "pending closing" — never fill it in code.
import 'server-only'
import { sql, tsql } from '@/lib/db'
import type {
  ClosingChecklistRow,
  ClosingLineRow,
  ClosingRow,
  DishUsage,
  FoodCostRow,
  IndentDetail,
  IndentFulfilmentRow,
  IndentLineRow,
  IndentRow,
  IssueDetail,
  KitchenComponentHit,
  KitchenDayRow,
  KitchenWastageRow,
  ProductionRow,
  Section,
  WasteByReasonRow,
  RefillSet,
  UnclosedDishRow,
} from '@/lib/types'

/** The stock-holding sections a chef closes: Kitchen and Bar org units. */
export async function getKitchenSections(restaurantId: string): Promise<Section[]> {
  return tsql<Section[]>`
    select id, code, name, sort_order, status, dept_group, receives_stock
    from sections
    where restaurant_id = ${restaurantId} and status = 'active'
      and dept_group in ('Kitchen', 'Bar')
    order by sort_order asc`
}

/** Departments a DISH may be coded to — SI NI CH CT TD BK BR and nothing
 *  else. dept_group was the wrong filter and let Security, Valet and
 *  Housekeeping into the dish picker: they are org units that receive
 *  issues and post staff, but no dish is ever "a Security dish". The dish
 *  code carries the department forever, so a wrong one here is permanent. */
export async function getDishCodingSections(restaurantId: string): Promise<Section[]> {
  return tsql<Section[]>`
    select id, code, name, sort_order, status, dept_group, receives_stock
    from sections
    where restaurant_id = ${restaurantId} and status = 'active' and codes_dishes
    order by sort_order asc`
}

/** One row per kitchen section for a date: today's effective closing (or
 * null), with the filing count so corrections wear their marker. */
export async function getClosingChecklist(restaurantId: string, date: string): Promise<ClosingChecklistRow[]> {
  return tsql<ClosingChecklistRow[]>`
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
  const rows = await tsql<ClosingRow[]>`
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
         w.recipe_id, r.code as recipe_code, r.name as recipe_name, r.output_unit,
         w.qty::text as qty, w.value::text as value, w.reason, w.note,
         w.reverses_id,
         (w.reverses_id is not null) as is_reversal,
         exists (select 1 from kitchen_wastage x where x.reverses_id = w.id) as is_voided,
         w.entered_by, w.created_at::text as created_at
  from kitchen_wastage w
  join sections s on s.id = w.section_id
  left join items i on i.id = w.item_id
  left join recipes r on r.id = w.recipe_id`

export async function getKitchenWastageById(restaurantId: string, id: string): Promise<KitchenWastageRow | null> {
  const rows = await tsql<KitchenWastageRow[]>`
    ${sql.unsafe(KW_SELECT)}
    where w.restaurant_id = ${restaurantId} and w.id = ${id}`
  return rows[0] ?? null
}

export async function listKitchenWastage(restaurantId: string, limit = 40): Promise<KitchenWastageRow[]> {
  return tsql<KitchenWastageRow[]>`
    ${sql.unsafe(KW_SELECT)}
    where w.restaurant_id = ${restaurantId}
    order by w.waste_date desc, w.created_at desc
    limit ${limit}`
}

// ---------------------------------------------------------------- indents

const INDENT_SELECT = `
  select i.id, i.indent_date::text as indent_date, i.section_id, i.session,
         s.code as section_code, s.name as section_name, i.status, i.note,
         i.entered_by, i.created_at::text as created_at,
         (select count(*)::int from indent_lines l where l.indent_id = i.id) as line_count
  from indents i join sections s on s.id = i.section_id`

export async function listIndents(restaurantId: string, limit = 30): Promise<IndentRow[]> {
  return tsql<IndentRow[]>`
    ${sql.unsafe(INDENT_SELECT)}
    where i.restaurant_id = ${restaurantId}
    order by (i.status = 'open') desc, i.indent_date desc, i.created_at desc
    limit ${limit}`
}

export async function getIndent(restaurantId: string, id: string): Promise<IndentRow | null> {
  const rows = await tsql<IndentRow[]>`
    ${sql.unsafe(INDENT_SELECT)}
    where i.restaurant_id = ${restaurantId} and i.id = ${id}`
  return rows[0] ?? null
}

export async function getIndentLines(indentId: string): Promise<IndentLineRow[]> {
  return tsql<IndentLineRow[]>`
    select l.id, l.item_id, it.code as item_code, it.name as item_name,
           it.purchase_unit, l.qty_requested::text as qty_requested
    from indent_lines l join items it on it.id = l.item_id
    where l.indent_id = ${indentId}
    order by it.name asc`
}

/** The whole indent page: header, asked lines, the live issues stamped
 * with it, and the asked-vs-given gap per item. Voided issues are out of
 * the given column — their reversal carries no indent stamp. */
export async function getIndentDetail(restaurantId: string, id: string): Promise<IndentDetail | null> {
  const indent = await getIndent(restaurantId, id)
  if (!indent) return null
  const lines = await getIndentLines(id)
  const issues = await tsql<IssueDetail[]>`
    select i.id, i.issue_date::text as issue_date, i.section_id, s.code as section_code, s.name as section_name,
           i.note, i.indent_id, i.reverses_id, i.entered_by, i.created_at::text as created_at,
           (i.reverses_id is not null) as is_reversal,
           exists (select 1 from issues r where r.reverses_id = i.id) as is_voided,
           (select count(*)::int from issue_lines il where il.issue_id = i.id) as line_count,
           (select coalesce(sum(il.value), 0)::text from issue_lines il where il.issue_id = i.id) as total_value
    from issues i join sections s on s.id = i.section_id
    where i.restaurant_id = ${restaurantId} and i.indent_id = ${id}
    order by i.created_at asc`
  const gap = await tsql<IndentDetail['gap']>`
    with asked as (
      select l.item_id, sum(l.qty_requested) as qty_requested
      from indent_lines l where l.indent_id = ${id} group by 1
    ),
    given as (
      select il.item_id, sum(il.qty) as qty_issued
      from issues i join issue_lines il on il.issue_id = i.id
      where i.indent_id = ${id} and i.reverses_id is null
        and not exists (select 1 from issues r where r.reverses_id = i.id)
      group by 1
    )
    select coalesce(a.item_id, g.item_id) as item_id, it.code as item_code,
           it.name as item_name, it.purchase_unit,
           a.qty_requested::text as qty_requested,
           g.qty_issued::text as qty_issued,
           (coalesce(g.qty_issued, 0) - coalesce(a.qty_requested, 0))::text as gap
    from asked a
    full outer join given g on g.item_id = a.item_id
    join items it on it.id = coalesce(a.item_id, g.item_id)
    order by it.name asc`
  return { indent, lines, issues, gap }
}

// ------------------------------------------------------------- productions

const PRODUCTION_SELECT = `
  select p.id, p.prod_date::text as prod_date, p.section_id,
         s.code as section_code, s.name as section_name,
         p.recipe_id, r.code as recipe_code, r.name as recipe_name,
         p.output_qty::text as output_qty, r.output_unit,
         p.unit_cost::text as unit_cost, p.value::text as value,
         p.note, p.reverses_id,
         (p.reverses_id is not null) as is_reversal,
         exists (select 1 from productions x where x.reverses_id = p.id) as is_voided,
         p.entered_by, p.created_at::text as created_at
  from productions p
  join sections s on s.id = p.section_id
  join recipes r on r.id = p.recipe_id`

export async function getProduction(restaurantId: string, id: string): Promise<ProductionRow | null> {
  const rows = await tsql<ProductionRow[]>`
    ${sql.unsafe(PRODUCTION_SELECT)}
    where p.restaurant_id = ${restaurantId} and p.id = ${id}`
  return rows[0] ?? null
}

export async function listProductions(restaurantId: string, limit = 30): Promise<ProductionRow[]> {
  return tsql<ProductionRow[]>`
    ${sql.unsafe(PRODUCTION_SELECT)}
    where p.restaurant_id = ${restaurantId}
    order by p.prod_date desc, p.created_at desc
    limit ${limit}`
}

/** Today's productions in a section — the closing picker's suggestions:
 * what was made today is what is most likely still on the shelf tonight. */
export async function getTodaysProductions(restaurantId: string, sectionId: string, date: string): Promise<ProductionRow[]> {
  return tsql<ProductionRow[]>`
    ${sql.unsafe(PRODUCTION_SELECT)}
    where p.restaurant_id = ${restaurantId} and p.section_id = ${sectionId}
      and p.prod_date = ${date}::date and p.reverses_id is null
      and not exists (select 1 from productions x where x.reverses_id = p.id)
    order by p.created_at desc`
}

/**
 * Dishes produced today that tonight's closing has not accounted for.
 *
 * The whole justification for producing dishes at all: produced portions must
 * be HELD AND COUNTED. Without this read the feature stores rows nobody looks
 * at, which is exactly the failure the session column taught.
 *
 * Compared against the WINNING closing for that (section, date) — a closing is
 * re-filed to correct it, and a superseded one must not make a gap disappear.
 * A section with no closing at all counts as closed = 0, which is the honest
 * answer: nothing has accounted for it yet.
 */
export async function getUnclosedDishes(restaurantId: string, date: string): Promise<UnclosedDishRow[]> {
  return tsql<UnclosedDishRow[]>`
    with made as (
      select p.section_id, p.recipe_id, sum(p.output_qty) as produced
      from productions p
      join recipes r on r.id = p.recipe_id
      where p.restaurant_id = ${restaurantId} and p.prod_date = ${date}::date
        and r.kind = 'dish'
        and p.reverses_id is null
        and not exists (select 1 from productions v where v.reverses_id = p.id)
      group by p.section_id, p.recipe_id
      having sum(p.output_qty) > 0
    ),
    winner as (
      select distinct on (c.section_id) c.id, c.section_id
      from kitchen_closings c
      where c.restaurant_id = ${restaurantId} and c.close_date = ${date}::date
      order by c.section_id, c.created_at desc
    ),
    held as (
      select w.section_id, cl.component_recipe_id as recipe_id, sum(cl.qty) as closed
      from kitchen_closing_lines cl
      join winner w on w.id = cl.closing_id
      where cl.restaurant_id = ${restaurantId} and cl.component_recipe_id is not null
      group by w.section_id, cl.component_recipe_id
    )
    select m.section_id, s.name as section_name, m.recipe_id, r.code, r.name,
           m.produced::text as produced,
           coalesce(h.closed, 0)::text as closed
    from made m
    join recipes r on r.id = m.recipe_id
    join sections s on s.id = m.section_id
    left join held h on h.section_id = m.section_id and h.recipe_id = m.recipe_id
    where coalesce(h.closed, 0) < m.produced
    order by s.name asc, r.name asc`
}

// ----------------------------------- three-component picker (closing etc.)

/**
 * Search raw items ∪ sub-recipes ∪ dishes for the itemized closing and kitchen
 * wastage pickers. Each hit says whether it can be costed — the save freezes
 * that cost; an uncosted pick is refused with the reason.
 *
 * SCOPED AND RANKED BY THE DEPARTMENT when one is given, and the department is
 * picked before the lines on both forms.
 *
 * WHAT A DEPARTMENT CAN HOLD IS WHAT IT WAS ISSUED PLUS WHAT IT MAKES, and
 * that is the whole scope — no new history table and no new reversal filter to
 * get wrong. `section_frequent_items` already answers the item half (30 days,
 * voids excluded) and `productions` the recipe half. A closing or a loss for
 * something the department has never received and never cooked is possible and
 * stays reachable underneath; it is simply not the first guess.
 *
 * Deliberately NOT sourced from past closings: a closing is corrected by
 * RE-FILING, so `kitchen_closings` carries no `reverses_id` and only the latest
 * row per (section, date) counts. Ranking off it would mean getting that
 * "latest wins" right in a second place for no gain, since refill-from-last
 * already offers a department its previous closing verbatim.
 */
export async function searchKitchenComponents(
  restaurantId: string,
  q: string,
  sectionId: string | null = null,
): Promise<KitchenComponentHit[]> {
  const like = `%${q}%`
  const prefix = `${q}%`
  const items = await tsql<Omit<KitchenComponentHit, 'kind'>[]>`
    select i.id, i.code, i.name, u.name as unit_name, (ic.issue_cost is not null) as has_cost,
           ic.issue_cost::text as unit_cost,
           (f.item_id is not null) as from_section
    from items i
    join units u on u.code = i.purchase_unit
    left join item_costs ic on ic.item_id = i.id
    left join section_frequent_items f
      on f.item_id = i.id and f.restaurant_id = i.restaurant_id
     and f.section_id = ${sectionId}::uuid
    where i.restaurant_id = ${restaurantId} and i.status = 'active'
      and (i.name ilike ${like} or i.code ilike ${like})
    order by (f.item_id is not null) desc, f.times_issued desc nulls last,
             (i.name ilike ${prefix}) desc, i.name asc
    limit 6`
  const recipes = await tsql<KitchenComponentHit[]>`
    select case when r.kind = 'sub' then 'sub' else 'dish' end as kind,
           r.id, r.code, r.name, u.name as unit_name,
           (case when r.kind = 'sub' then rc.cost_per_output_unit else dc.dish_cost end is not null) as has_cost,
           (case when r.kind = 'sub' then rc.cost_per_output_unit else dc.dish_cost end)::text as unit_cost,
           (pr.recipe_id is not null) as from_section
    from recipes r
    join units u on u.code = r.output_unit
    left join recipe_costs rc on rc.recipe_id = r.id
    left join dish_costs dc on dc.recipe_id = r.id
    left join (
      select p.recipe_id, count(*) as times
      from productions p
      where p.restaurant_id = ${restaurantId}
        and p.section_id = ${sectionId}::uuid
        and p.reverses_id is null
        and not exists (select 1 from productions x where x.reverses_id = p.id)
      group by p.recipe_id
    ) pr on pr.recipe_id = r.id
    where r.restaurant_id = ${restaurantId} and r.status = 'active'
      and (r.name ilike ${like} or r.code ilike ${like})
    order by (pr.recipe_id is not null) desc, pr.times desc nulls last,
             (r.name ilike ${prefix}) desc, r.name asc
    limit 8`
  return [...items.map((r) => ({ kind: 'item' as const, ...r })), ...recipes]
}

export async function getClosingLines(closingId: string): Promise<ClosingLineRow[]> {
  return tsql<ClosingLineRow[]>`
    select cl.id,
           case when cl.component_item_id is not null then 'item'
                when r.kind = 'sub' then 'sub' else 'dish' end as kind,
           coalesce(i.code, r.code) as component_code,
           coalesce(i.name, r.name) as component_name,
           coalesce(i.purchase_unit, r.output_unit) as unit,
           cl.qty::text as qty, cl.unit_cost::text as unit_cost, cl.value::text as value
    from kitchen_closing_lines cl
    left join items i on i.id = cl.component_item_id
    left join recipes r on r.id = cl.component_recipe_id
    where cl.closing_id = ${closingId}
    order by coalesce(i.name, r.name) asc`
}

// --------------------------------------------------------------- analytics

/** One day of kitchen truth per section: issued vs produced vs wasted vs
 * closed. Sums run over ALL rows (reversals included) so voids net out;
 * closed comes from kitchen_closing_current — null means not closed. */
export async function getKitchenDay(restaurantId: string, date: string): Promise<KitchenDayRow[]> {
  return tsql<KitchenDayRow[]>`
    select s.id as section_id, s.code as section_code, s.name as section_name,
           coalesce(iss.v, 0)::text as issued,
           coalesce(pr.v, 0)::text as produced,
           coalesce(kw.v, 0)::text as wasted,
           c.closing_value::text as closed
    from sections s
    left join lateral (
      select sum(il.value) as v from issues i join issue_lines il on il.issue_id = i.id
      where i.section_id = s.id and i.issue_date = ${date}::date
    ) iss on true
    left join lateral (
      select sum(p.value) as v from productions p
      where p.section_id = s.id and p.prod_date = ${date}::date
    ) pr on true
    left join lateral (
      select sum(w.value) as v from kitchen_wastage w
      where w.section_id = s.id and w.waste_date = ${date}::date
    ) kw on true
    left join kitchen_closing_current c on c.section_id = s.id and c.close_date = ${date}::date
    where s.restaurant_id = ${restaurantId} and s.status = 'active'
      and s.dept_group in ('Kitchen', 'Bar')
    order by s.sort_order asc`
}

/** Kitchen wastage by reason for one month — reversals net out in the sum. */
export async function getWasteByReason(restaurantId: string, monthStart: string): Promise<WasteByReasonRow[]> {
  return tsql<WasteByReasonRow[]>`
    select reason,
           count(*) filter (where reverses_id is null)::int as entries,
           coalesce(sum(value), 0)::text as value
    from kitchen_wastage
    where restaurant_id = ${restaurantId}
      and date_trunc('month', waste_date)::date = ${monthStart}::date
    group by reason
    having sum(value) <> 0 or count(*) filter (where reverses_id is null) > 0
    order by sum(value) desc`
}

/** Food cost for one month. Sections with no issues that month have no
 * section_consumption row and therefore no view row — they are listed with
 * nulls so the page can say "no issues this month" instead of hiding them. */
export async function getFoodCost(restaurantId: string, monthStart: string): Promise<FoodCostRow[]> {
  return tsql<FoodCostRow[]>`
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

/** One indent as ONE TABLE — asked, given, and the gap between them.
 *
 * Request, received and return are three states of one document, not three
 * screens. indent_fulfilment computes the gap; nothing here recomputes it,
 * and nothing hides it: a kitchen that asked for 5 and got 3 needs to see
 * the 2, because that is the conversation the sheet used to force. */
export async function getIndentFulfilment(
  restaurantId: string,
  indentId: string,
): Promise<IndentFulfilmentRow[]> {
  return tsql<IndentFulfilmentRow[]>`
    select indent_id, indent_date::text as indent_date, session,
           section_code, section_name, status,
           item_code, item_name, purchase_unit,
           qty_requested::text as qty_requested,
           -- NOT coalesced. A cancelled indent returns NULL for both: a
           -- request nobody was ever going to fill has no shortage, and a
           -- zero here would read as "asked and got nothing".
           qty_given::text as qty_given,
           gap::text as gap
    from indent_fulfilment
    where restaurant_id = ${restaurantId} and indent_id = ${indentId}
    order by item_name asc`
}

/** The most recent indent for a department + session — what "refill from
 *  last request" copies. The single biggest daily saving in the product:
 *  the evening kitchen asks for nearly the same things every evening. */
export async function getLastIndentFor(
  restaurantId: string,
  sectionId: string,
  session: string,
): Promise<string | null> {
  const rows = await tsql<{ id: string }[]>`
    select id from indents
    where restaurant_id = ${restaurantId} and section_id = ${sectionId} and session = ${session}
    order by indent_date desc, created_at desc
    limit 1`
  return rows[0]?.id ?? null
}

/* ── REFILL FROM LAST ──────────────────────────────────────────────────────
   The same mechanic the indent already has: load the most recent set for
   this department, put it on screen editable, and write nothing until Save.

   Worth most on production — a kitchen makes broadly the same batches every
   day. Worth nearly as much on closing, where last night is the best first
   guess at tonight and the chef corrects rather than starting blank at
   midnight.

   Reversals and voided rows are excluded: a batch that was cancelled is not
   a suggestion for tomorrow. */

/**
 * What a department actually makes — the rank for the production picker.
 *
 * The department is picked before the lines, so this is context the form
 * already had and was throwing away: `listProducibles` orders
 * `kind desc, code asc`, which is subs-then-dishes alphabetically. A kitchen
 * makes broadly the same batches every day.
 *
 * FREQUENCY THEN RECENCY. Voided batches are excluded both ways — a cancelled
 * batch is not evidence of a habit, the same rule the refill offer already
 * applies.
 *
 * `scope` is the section id, so one query answers for every department and the
 * page does not fan out one read per section.
 */
export async function getProductionHistory(restaurantId: string, limit = 200): Promise<DishUsage[]> {
  return tsql<DishUsage[]>`
    select p.section_id::text as scope, p.recipe_id, count(*)::int as times,
           max(p.prod_date)::text as last
    from productions p
    where p.restaurant_id = ${restaurantId}
      and p.reverses_id is null
      and not exists (select 1 from productions x where x.reverses_id = p.id)
    group by p.section_id, p.recipe_id
    order by times desc, last desc
    limit ${limit}`
}

/** The most recent day this department recorded production, and what it made. */
export async function getLastProductionSet(
  restaurantId: string,
  sectionId: string,
): Promise<RefillSet> {
  const rows = await tsql<
    { on: string; id: string; code: string; name: string; unit_name: string; qty: string }[]
  >`
    with last_day as (
      select max(p.prod_date) as d
      from productions p
      where p.restaurant_id = ${restaurantId} and p.section_id = ${sectionId}
        and p.reverses_id is null
        and not exists (select 1 from productions v where v.reverses_id = p.id)
    )
    select p.prod_date::text as on, r.id, r.code, r.name,
           coalesce(r.output_unit, 'unit') as unit_name,
           p.output_qty::text as qty
    from productions p
    join recipes r on r.id = p.recipe_id
    join last_day l on l.d = p.prod_date
    where p.restaurant_id = ${restaurantId} and p.section_id = ${sectionId}
      and p.reverses_id is null
      and not exists (select 1 from productions v where v.reverses_id = p.id)
    order by r.name asc`
  if (rows.length === 0) return null
  return {
    on: rows[0].on,
    lines: rows.map((r) => ({
      kind: 'sub' as const,
      id: r.id,
      code: r.code,
      name: r.name,
      unit_name: r.unit_name,
      qty: r.qty,
    })),
  }
}

/** The most recent closing this department filed, and what it held.
 *
 *  Only the WINNING filing for that date — a closing is re-filed to correct
 *  it, and suggesting a superseded one would hand back the number somebody
 *  already decided was wrong. */
export async function getLastClosingSet(
  restaurantId: string,
  sectionId: string,
): Promise<RefillSet> {
  const rows = await tsql<
    {
      on: string
      kind: 'item' | 'sub' | 'dish'
      id: string
      code: string
      name: string
      unit_name: string
      qty: string
    }[]
  >`
    with winner as (
      select c.id, c.close_date
      from kitchen_closings c
      where c.restaurant_id = ${restaurantId} and c.section_id = ${sectionId}
      order by c.close_date desc, c.created_at desc
      limit 1
    )
    select w.close_date::text as on,
           case when cl.component_item_id is not null then 'item'
                when r.kind = 'sub' then 'sub' else 'dish' end as kind,
           coalesce(cl.component_item_id, cl.component_recipe_id)::text as id,
           coalesce(i.code, r.code) as code,
           coalesce(i.name, r.name) as name,
           coalesce(u.name, r.output_unit, 'unit') as unit_name,
           cl.qty::text as qty
    from kitchen_closing_lines cl
    join winner w on w.id = cl.closing_id
    left join items i on i.id = cl.component_item_id
    left join units u on u.code = i.stock_unit
    left join recipes r on r.id = cl.component_recipe_id
    where cl.restaurant_id = ${restaurantId}
    order by name asc`
  if (rows.length === 0) return null
  return {
    on: rows[0].on,
    lines: rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      code: r.code,
      name: r.name,
      unit_name: r.unit_name,
      qty: r.qty,
    })),
  }
}
