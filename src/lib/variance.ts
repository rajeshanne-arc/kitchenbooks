// ACTUAL VS THEORETICAL — and the guards that decide whether it may be said.
//
// The category's defining report: not "food cost was 34%" but "you used
// ₹7,150 more than the recipes say". That difference is where over-portioning,
// unrecorded waste and theft actually appear, and it is what every operational
// habit in this app — the nightly closing, the issue, the recipe card — exists
// to produce.
//
// Both halves already existed and nothing joined them. `section_food_cost` is
// the ACTUAL side (opening + issued − closing); `theoretical_food_cost` is
// qty sold × cost_per_portion for dishes and qty sold × issue_cost for resold
// items. `food_cost_variance` is the join, and this file is the question of
// when its number may be shown to a human.
//
// COVERAGE IS THE SAFETY MECHANISM, NOT DECORATION. If half a section's
// revenue cannot be costed, the theoretical is half-built, and the variance
// measures the MAPPING rather than the kitchen. A number that reads as theft
// when it is really a data gap is worse than no number at all — so the rule is
// a floor, the refusal names the figure, and the coverage is stated even when
// it passes, so nobody reads 94% as 100%.
//
// THE REASONING IS PURE AND LIVES HERE ONCE, because two screens ask it — the
// department page about one department, the owner dashboard about the
// restaurant — and two implementations of a refusal are two chances to show a
// number the other one would have withheld.

import { decimalStringToPaise } from '@/lib/money'

/**
 * Below this share of costable revenue the variance is not stated.
 *
 * NOT A SETTING, and it must never become one. Settings configure a
 * restaurant's vocabulary and its local rules; what a NUMBER MEANS is not
 * theirs. A floor that two restaurants could set differently would make their
 * variances mean different things, which is the exact test in AGENTS.md for a
 * setting that must not exist.
 */
export const COVERAGE_FLOOR = 90

/** One row of `food_cost_variance` — a section for a month. */
export type VarianceRow = {
  section_code: string
  section_name: string
  month: string
  revenue: string
  costable_revenue: string | null
  /** NULL when nothing was costable — a sum over no rows is not a zero. */
  coverage_pct: string | null
  theoretical_cost: string
  theoretical_pct: string | null
  /** section_food_cost.consumed_total — NULL until the month has a closing. */
  actual_cost: string | null
  actual_pct: string | null
  variance_value: string | null
  variance_pct: string | null
  closing_filed: boolean
  no_consumption: boolean
  nothing_costable: boolean
}

/**
 * A dish that is mapped, sold, and priced at ZERO in the theoretical.
 *
 * MEASURED, NOT REASONED FROM THE DEFINITION — the probe is in smoke:a2.
 * `theoretical_food_cost` joins `dish_costs ON dc.recipe_id = m.recipe_id AND
 * dc.dish_cost > 0`, and `dish_costs.cost_per_portion` is
 * `total_cost / NULLIF(portions, 0)`. So a dish with a real recipe cost and NO
 * portion count still satisfies that join: its revenue counts as COSTABLE
 * while `qty × NULL` contributes nothing to the cost.
 *
 * Measured on the probe tenant, rolled back: mapping one portion-less dish
 * moved costable_revenue 2000 → 3000 and left coverage at **100.0%** while
 * theoretical_cost stayed at 300. The variance then reads as ₹1,000 of
 * revenue consumed out of thin air — overspending that is really a blank
 * field on a dish card.
 *
 * THE COVERAGE FLOOR STRUCTURALLY CANNOT SEE THIS, because coverage says
 * 100%. So it is a separate guard, and it refuses on its own.
 */
export type ZeroCostDish = {
  recipe_id: string
  code: string
  name: string
  section_code: string
  revenue: string
}

export type VarianceVerdict =
  /** Say it. */
  | { state: 'stated'; row: VarianceRow; variancePaise: number }
  /** Nothing sold here points at anything with a cost. */
  | { state: 'nothing-costable'; needs: string; why: string }
  /** Mapped dishes priced at zero — the theoretical is understated. */
  | { state: 'zero-cost-dishes'; needs: string; why: string; dishes: ZeroCostDish[] }
  /** Too little of the revenue is costable to be measuring the kitchen. */
  | { state: 'low-coverage'; needs: string; why: string; coverage: number }
  /** The actual half has not arrived: no closing, or nothing consumed. */
  | { state: 'no-actual'; needs: string; why: string }

/**
 * May this row's variance be shown, and if not, why not — in the subject's
 * own name.
 *
 * ORDER MATTERS AND IS ARGUED:
 *
 *  1. `nothing_costable` first — at 0% coverage there is no theoretical at
 *     all, and the low-coverage sentence would invite somebody to close a gap
 *     that has not been started.
 *  2. ZERO-COST DISHES SECOND, ahead of the coverage floor, because coverage
 *     reads 100% in exactly that state and would wave a knowingly wrong
 *     number straight through. This is the one guard the floor cannot
 *     subsume.
 *  3. The coverage floor.
 *  4. The actual half. Last because it is the errand a chef can finish
 *     tonight, and naming it while the theoretical is unbuilt would send them
 *     to file a closing that still could not produce an answer.
 *
 * NEVER computed from issues alone when a closing is missing. Issued is not
 * consumed — a kitchen draws ten kilos on Monday and cooks it over three days
 * — and that shortcut is the one that would make this report lie. The view
 * already returns NULL; nothing here fills it in.
 */
export function assessVariance(
  row: VarianceRow,
  zeroCostDishes: ZeroCostDish[],
  subject: string,
  monthLabel: string,
): VarianceVerdict {
  if (row.nothing_costable || row.coverage_pct === null) {
    return {
      state: 'nothing-costable',
      needs: 'nothing costable sold',
      why: `Nothing sold under ${subject} in ${monthLabel} points at a dish or a stock item, so there is no theoretical cost to compare against. Map its POS items first.`,
    }
  }

  if (zeroCostDishes.length > 0) {
    const n = zeroCostDishes.length
    return {
      state: 'zero-cost-dishes',
      needs: n === 1 ? 'a dish has no portion count' : `${n} dishes have no portion count`,
      why: `${zeroCostDishes.map((d) => d.name).join(', ')} sold in ${monthLabel} with no portion count set, so ${n === 1 ? 'its' : 'their'} cost enters the theoretical as zero while the revenue still counts as costed. The variance would read as overspending that is really a blank field on a dish card.`,
      dishes: zeroCostDishes,
    }
  }

  const coverage = Number(row.coverage_pct)
  if (coverage < COVERAGE_FLOOR) {
    return {
      state: 'low-coverage',
      needs: `${row.coverage_pct}% costed`,
      why: `${subject} is ${row.coverage_pct}% costed — the variance would be measuring the mapping, not the kitchen. It is stated above ${COVERAGE_FLOOR}%.`,
      coverage,
    }
  }

  // The view computes variance_value as actual − theoretical and returns NULL
  // when the actual half is missing; the two are the same condition, and this
  // reads the published column rather than subtracting again here.
  if (row.actual_cost === null || row.variance_value === null) {
    return {
      state: 'no-actual',
      needs: row.closing_filed ? 'nothing consumed' : 'pending closing',
      why: row.closing_filed
        ? `Nothing has been issued to ${subject} in ${monthLabel}, so there is no actual consumption to set against the recipes.`
        : `${subject} has not said what it still holds at the end of ${monthLabel}, so what it actually consumed cannot be worked out. Issued is not consumed — a kitchen draws ten kilos on Monday and cooks it over three days — so nothing is assumed in its place.`,
    }
  }

  return { state: 'stated', row, variancePaise: decimalStringToPaise(row.variance_value) }
}

/**
 * The restaurant total — the sum over the sections that can be assessed, and
 * the named list of the ones that cannot.
 *
 * A TOTAL OVER SOME SECTIONS IS NOT THE RESTAURANT'S VARIANCE, so the count of
 * what is in and what is out travels with the figure rather than being implied
 * by it. Summing a section whose actual half is missing would quietly read its
 * consumption as zero and flatter the whole restaurant.
 */
export type VarianceTotal = {
  stated: { row: VarianceRow; variancePaise: number }[]
  excluded: { row: VarianceRow; verdict: Exclude<VarianceVerdict, { state: 'stated' }> }[]
  theoreticalPaise: number
  actualPaise: number
  variancePaise: number
  /** Revenue of the sections that are IN, so a share means something. */
  revenuePaise: number
}

export function totalVariance(
  rows: VarianceRow[],
  zeroCostBySection: Map<string, ZeroCostDish[]>,
  monthLabel: string,
): VarianceTotal {
  const stated: VarianceTotal['stated'] = []
  const excluded: VarianceTotal['excluded'] = []
  for (const row of rows) {
    const verdict = assessVariance(
      row,
      zeroCostBySection.get(row.section_code) ?? [],
      row.section_name,
      monthLabel,
    )
    if (verdict.state === 'stated') stated.push({ row, variancePaise: verdict.variancePaise })
    else excluded.push({ row, verdict })
  }
  const theoreticalPaise = stated.reduce((n, s) => n + decimalStringToPaise(s.row.theoretical_cost), 0)
  const actualPaise = stated.reduce((n, s) => n + decimalStringToPaise(s.row.actual_cost ?? '0'), 0)
  const revenuePaise = stated.reduce((n, s) => n + decimalStringToPaise(s.row.revenue), 0)
  return {
    stated,
    excluded,
    theoreticalPaise,
    actualPaise,
    variancePaise: actualPaise - theoreticalPaise,
    revenuePaise,
  }
}

/**
 * What has to arrive before this report can answer — four counts, each with
 * its figure, never a generic sentence.
 *
 * An empty state saying "no data" teaches nobody what to do. Naming the four
 * with their counts is what makes weeks of data entry legible: a chef asked
 * for a nightly closing deserves to see what it produces.
 */
export type VariancePreconditions = {
  itemsMapped: number
  itemsSeen: number
  /** Revenue attributed to nothing at all. `revenue_mapped` is NULL when
   *  nothing is mapped — a sum over no rows is not a zero. */
  unattributed: string
  revenueSeen: string
  dishesCostable: number
  dishesTotal: number
  /** Costed recipe, NO portion count — the theoretical would price these at
   *  zero. Counted apart from `dishesUncosted` because the errands differ:
   *  one is a number to type on the dish card, the other is a bill to enter.
   *  Live today this is the whole story — Chicken 65 costs ₹316.67 and has no
   *  portions, so it is one mapping away from understating South Indian. */
  dishesNoPortions: number
  /** No cost at all — an ingredient with no bill behind it. */
  dishesUncosted: number
  issues: number
  closingsFiled: number
  closableSections: number
}

/** True while any leg has not started at all — the difference between "this
 *  report is not ready" and "this section is not ready". */
export const nothingStarted = (p: VariancePreconditions): boolean =>
  p.itemsMapped === 0 || p.dishesCostable === 0 || p.issues === 0 || p.closingsFiled === 0
