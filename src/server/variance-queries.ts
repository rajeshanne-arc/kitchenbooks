// ACTUAL VS THEORETICAL — the read side.
//
// Two views do the work and nothing here recomputes either of them:
// `theoretical_food_cost` is qty sold × cost_per_portion for dishes and
// qty sold × issue_cost for resold stock items, and `food_cost_variance`
// joins it to `section_food_cost` (opening + issued − closing). This file
// reads them, and adds the two measurements no view publishes: the dishes
// whose cost enters the theoretical as ZERO, and the four counts an empty
// report has to name.
//
// THE READS ARE BATCHED. Each `tsql` is BEGIN + SET LOCAL + query + COMMIT —
// three round trips, ~600ms from Mumbai per read — and these render inside a
// group layout that is already holding connections from a max: 12 pool. A
// `tsql` is NEVER nested inside a `txn()` callback: that opens a second
// connection while holding the first, which is the max:4 deadlock in a new
// costume, and a gate fails on it.

import 'server-only'
import { txn, tsql } from '@/lib/db'
import type { VariancePreconditions, VarianceRow, ZeroCostDish } from '@/lib/variance'

/**
 * The variance per section for one month, worst overspend first.
 *
 * MONTHLY, LIKE ITS TWO HALVES. `section_food_cost` takes its opening from the
 * last closing BEFORE the month and its ending from the last one inside it;
 * there is no part-month form of that, so a period reports its LAST month and
 * the screen names which. A blended figure across months would be a lie.
 *
 * The '—' / Unmapped bucket is EXCLUDED here and reported by the preconditions
 * instead: it is not a department, it is the revenue that reached none, and
 * ranking it beside real sections would put a data gap in the league table.
 */
export async function getFoodCostVariance(
  restaurantId: string,
  monthStart: string,
): Promise<VarianceRow[]> {
  return tsql<VarianceRow[]>`
    select section_code, section_name, month::text as month,
           revenue::text as revenue,
           costable_revenue::text as costable_revenue,
           coverage_pct::text as coverage_pct,
           theoretical_cost::text as theoretical_cost,
           theoretical_pct::text as theoretical_pct,
           -- NOT coalesced. NULL is "no closing filed yet", and a zero here
           -- would read as "consumed nothing", which is the shortcut this
           -- whole report exists to refuse.
           actual_cost::text as actual_cost,
           actual_pct::text as actual_pct,
           variance_value::text as variance_value,
           variance_pct::text as variance_pct,
           closing_filed, no_consumption, nothing_costable
    from food_cost_variance
    where restaurant_id = ${restaurantId}
      and month = ${monthStart}::date
      and section_code <> '—'
    order by variance_value desc nulls last, section_code asc`
}

/**
 * Dishes that are mapped and sold and whose cost lands as ZERO — the guard the
 * coverage floor structurally cannot see.
 *
 * `theoretical_food_cost` joins `dish_costs ON dc.recipe_id = m.recipe_id AND
 * dc.dish_cost > 0`, and `cost_per_portion` is `total_cost / NULLIF(portions,
 * 0)`. A dish with a real recipe cost and no portion count therefore satisfies
 * the join — its revenue counts as COSTABLE while `qty × NULL` adds nothing to
 * the cost. Coverage reads 100% and the theoretical is short by whatever those
 * dishes should have cost, so the variance reads as overspending.
 *
 * Measured on the probe tenant rather than reasoned from the definition: one
 * portion-less dish moved costable_revenue 2000 → 3000 with coverage still
 * 100.0% and theoretical_cost still 300.
 */
export async function getZeroCostDishes(
  restaurantId: string,
  monthStart: string,
  // OPTIONAL HANDLE so a caller inside a transaction can lend its own — the
  // getClosePrefill shape. It is what lets the gate build the fixture, run
  // THIS function against it and roll back, rather than asserting against a
  // hand-written copy of the query: a probe that writes its own SQL cannot
  // test the app's.
  db: typeof tsql = tsql,
): Promise<ZeroCostDish[]> {
  return db<ZeroCostDish[]>`
    select r.id as recipe_id, r.code, r.name, s.code as section_code,
           sum(pl.amount)::text as revenue
    from sales_current sc
    join pos_lines pl on pl.order_id = sc.id
    join pos_item_map m
      on m.restaurant_id = sc.restaurant_id and m.pos_item_id = pl.pos_item_id
    join dish_costs dc
      on dc.restaurant_id = sc.restaurant_id and dc.recipe_id = m.recipe_id and dc.dish_cost > 0
    join recipes r on r.restaurant_id = sc.restaurant_id and r.id = m.recipe_id
    join sections s on s.restaurant_id = sc.restaurant_id and s.id = r.section_id
    where sc.restaurant_id = ${restaurantId}
      and sc.status_class = 'revenue'
      and date_trunc('month', sc.business_date)::date = ${monthStart}::date
      -- the whole condition: a costable-looking dish with nothing to divide by
      and dc.cost_per_portion is null
    group by r.id, r.code, r.name, s.code
    order by sum(pl.amount) desc`
}

/**
 * The four things this report is waiting for, each with its count.
 *
 * NAMED, NEVER GENERIC. "No data yet" teaches nobody what to do; "0 of 218
 * POS items mapped, ₹39,78,502 unattributed, 1 dish with no portions, 2
 * issues, 0 of 9 closings" is a list somebody can work through. A chef asked
 * for a nightly closing deserves to see what it produces.
 *
 * Mapping coverage is ALL-TIME because `mapping_coverage` carries no date —
 * a mapping is a standing decision, not a monthly one. The other three are
 * scoped to the month being reported, because that is the month whose
 * variance is missing.
 */
export async function getVariancePreconditions(
  restaurantId: string,
  monthStart: string,
): Promise<VariancePreconditions> {
  return txn(async (tx) => {
    const [cov] = await tx<
      { items_seen: number; items_mapped: number; revenue_seen: string; unattributed: string }[]
    >`
      select items_seen::int as items_seen, items_mapped::int as items_mapped,
             revenue_seen::text as revenue_seen,
             -- SUBTRACTED IN POSTGRES numeric, never in JS. Money is exact
             -- integers in this app and a float here would drift on a figure
             -- somebody reads as rupees. COALESCE is safe on this side of the
             -- minus: revenue_mapped is NULL when nothing is mapped, and none
             -- of it attributed is exactly all of it unattributed.
             (revenue_seen - coalesce(revenue_mapped, 0))::text as unattributed
      from mapping_coverage
      where restaurant_id = ${restaurantId}`

    // THREE COUNTS, BECAUSE THE ERRANDS DIFFER. A dish with a cost and no
    // portion count needs a number typed on its card; a dish with no cost
    // needs a bill entered for its ingredients. Naming the wrong one sends
    // somebody on a job that cannot fix what they were shown.
    const [dishes] = await tx<
      { costable: number; no_portions: number; uncosted: number; total: number }[]
    >`
      select count(*) filter (where dc.dish_cost > 0 and dc.cost_per_portion is not null)::int as costable,
             count(*) filter (where dc.dish_cost > 0 and dc.cost_per_portion is null)::int as no_portions,
             count(*) filter (where coalesce(dc.dish_cost, 0) = 0)::int as uncosted,
             count(*)::int as total
      from recipes r
      left join dish_costs dc on dc.restaurant_id = r.restaurant_id and dc.recipe_id = r.id
      where r.restaurant_id = ${restaurantId} and r.kind = 'dish' and r.status = 'active'`

    const [issues] = await tx<{ n: number }[]>`
      select count(*)::int as n
      from issues i
      where i.restaurant_id = ${restaurantId}
        and i.issue_date >= ${monthStart}::date
        and i.issue_date < (${monthStart}::date + interval '1 month')
        and i.reverses_id is null
        and not exists (select 1 from issues v where v.reverses_id = i.id)`

    // EXISTS, not a LATERAL aliasing its own literal. The first version read
    // `select 1 as filed … ) c` and then counted `c.filed`, which audit:schema
    // correctly refused: `filed` is not a column of kitchen_closing_current,
    // and a checker that cannot see through the alias is telling the truth
    // about the text in front of it. Fixing the SQL beats teaching the gate to
    // look away.
    const [closings] = await tx<{ filed: number; closable: number }[]>`
      select count(*) filter (
               where exists (
                 select 1 from kitchen_closing_current c
                 where c.section_id = s.id
                   and c.close_date >= ${monthStart}::date
                   and c.close_date < (${monthStart}::date + interval '1 month')
               )
             )::int as filed,
             count(*)::int as closable
      from sections s
      where s.restaurant_id = ${restaurantId} and s.status = 'active'
        and s.dept_group in ('Kitchen', 'Bar')`

    // No POS day fetched at all means no mapping_coverage row — a view over no
    // rows, not a restaurant with nothing to map. Zeroes here are read by the
    // caller as "nothing has started", which is what that is.
    return {
      itemsMapped: cov?.items_mapped ?? 0,
      itemsSeen: cov?.items_seen ?? 0,
      revenueSeen: cov?.revenue_seen ?? '0',
      unattributed: cov?.unattributed ?? '0',
      dishesCostable: dishes?.costable ?? 0,
      dishesTotal: dishes?.total ?? 0,
      dishesNoPortions: dishes?.no_portions ?? 0,
      dishesUncosted: dishes?.uncosted ?? 0,
      issues: issues?.n ?? 0,
      closingsFiled: closings?.filed ?? 0,
      closableSections: closings?.closable ?? 0,
    }
  })
}
