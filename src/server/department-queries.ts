// The per-department drill-down. /kitchen/departments/[code].
//
// A DRILL-DOWN, NOT A NEW MEASUREMENT. Every figure on this page already
// existed in a named view; what was missing was a place to read them together
// for ONE department. Nothing here computes a total the database does not
// already publish, and nothing here caches one.
//
// TWO KEYS, AND CHOOSING THE WRONG ONE IS A 42703 ON A LIVE PAGE. The relations
// split cleanly and unhelpfully:
//
//   section_code TEXT   section_costs · section_food_cost ·
//                       labour_cost_by_section · section_consumption_daily ·
//                       indent_fulfilment · issue_frequency · dish_costs
//   section_id UUID     productions · kitchen_wastage ·
//                       kitchen_closing_current · issues · indents · staff
//
// So `getDepartment` resolves code → id once and every other function takes
// whichever key its relation actually publishes. The parameter names say which.
//
// THE READS ARE BATCHED. Ten `tsql` calls is ten transactions at three round
// trips each — ~600ms of Mumbai latency per read from a browser in India. They
// are grouped into `txn()` callbacks instead, and a `tsql` is NEVER nested
// inside one: that opens a second connection while holding the first, which is
// the max:4 deadlock in a new costume and a gate fails on it.

import 'server-only'
import { txn } from '@/lib/db'
import type {
  DepartmentDetail,
  IndentFulfilmentRow,
  IssueFrequencyRow,
  SectionCostMonthRow,
  SectionLabourMonthRow,
  SectionLossReasonRow,
  SectionShiftDayRow,
  SectionStaffRow,
} from '@/lib/types'

/** A department code is 2–4 letters, per-tenant, created by an owner. Checked
 *  before it reaches Postgres because a page param is public input. */
export const DEPT_CODE = /^[A-Za-z]{2,4}$/

/**
 * The one `sections` read the page hangs off — and the only place code → id is
 * resolved. `dishes` and `staff` are the header's counts and come from here so
 * the header needs no second trip.
 */
export async function getDepartment(
  restaurantId: string,
  code: string,
): Promise<DepartmentDetail | null> {
  if (!DEPT_CODE.test(code)) return null
  return txn(async (tx) => {
    const [row] = await tx<DepartmentDetail[]>`
      select s.id, s.code, s.name, s.dept_group, s.dept_kind,
             s.codes_dishes, s.receives_stock, s.status,
             (select count(*)::int from recipes r
               where r.section_id = s.id and r.kind = 'dish' and r.status = 'active') as dishes,
             (select count(*)::int from staff st
               where st.section_id = s.id and st.status = 'active') as staff
      from sections s
      where s.restaurant_id = ${restaurantId} and upper(s.code) = ${code.toUpperCase()}`
    return row ?? null
  })
}

/**
 * Everything keyed by section_code, in ONE transaction.
 *
 * `section_costs` is read UNCOALESCED per month and never summed in SQL. The
 * view already COALESCEs every figure to 0 internally and publishes no honesty
 * column, so a department with no POS day and no attendance reads
 * `sales 0, labour 0, margin −(consumption)` — which on a page titled after a
 * department is an accusation about a named team rather than a measurement.
 * The caller checks each leg against its own source before showing any of it.
 */
export async function getDepartmentByCode(
  restaurantId: string,
  sectionCode: string,
  months: string[],
  from: string,
  to: string,
): Promise<{
  costs: SectionCostMonthRow[]
  labour: SectionLabourMonthRow[]
  indents: IndentFulfilmentRow[]
  rhythm: IssueFrequencyRow[]
}> {
  return txn(async (tx) => {
    const costs = await tx<SectionCostMonthRow[]>`
      select month::text as month,
             consumption::text as consumption,
             labour::text as labour,
             total_cost::text as total_cost,
             sales::text as sales,
             margin::text as margin
      from section_costs
      where restaurant_id = ${restaurantId}
        and section_code = ${sectionCode}
        and month = any(${months}::date[])
      order by month asc`

    // unassigned_marks is deliberately not selected — see SectionLabourMonthRow.
    const labour = await tx<SectionLabourMonthRow[]>`
      select month::text as month,
             labour_cost::text as labour_cost,
             unsalaried_marks::int as unsalaried_marks
      from labour_cost_by_section
      where restaurant_id = ${restaurantId}
        and section_code = ${sectionCode}
        and month = any(${months}::date[])
      order by month asc`

    // NEITHER qty_given NOR gap IS COALESCED. A cancelled indent returns NULL
    // for both — a request nobody was ever going to fill has no shortage — and
    // a dash coalesced out of it reads as "asked and got exactly what we asked
    // for", which is the opposite of the truth.
    const indents = await tx<IndentFulfilmentRow[]>`
      select indent_id, indent_date::text as indent_date, session,
             section_code, section_name, status,
             item_code, item_name, purchase_unit,
             qty_requested::text as qty_requested,
             qty_given::text as qty_given,
             gap::text as gap
      from indent_fulfilment
      where restaurant_id = ${restaurantId}
        and section_code = ${sectionCode}
        and indent_date between ${from}::date and ${to}::date
      -- indent_id keeps one request's lines together — two indents on the same
      -- date would otherwise interleave — and makes the order total, so equal
      -- rows do not shuffle between reloads on the planner's whim.
      order by indent_date desc, indent_id, item_code asc`

    const rhythm = await tx<IssueFrequencyRow[]>`
      select issue_date::text as issue_date,
             issue_count::int as issue_count,
             sessions,
             extra_count::int as extra_count
      from issue_frequency
      where restaurant_id = ${restaurantId}
        and section_code = ${sectionCode}
        and issue_date between ${from}::date and ${to}::date
      order by issue_date desc`

    return { costs, labour, indents, rhythm }
  })
}

/**
 * Everything keyed by section_id, in ONE transaction.
 *
 * REVERSALS, and there are two right patterns and one wrong one. Summing over
 * every row is safe because the negative twin nets to zero; COUNTING or LISTING
 * must exclude BOTH halves. `reverses_id is null` alone is the wrong middle —
 * it drops the twin and keeps the voided original at full value, so a cancelled
 * batch reads as live. Both are used below and each says which it is.
 *
 * `kitchen_closings` has NO reverses_id: a closing is corrected by RE-FILING,
 * so the parent state to filter on is "is this the winning filing", which is
 * what `kitchen_closing_current` already answers. Joining plain
 * `kitchen_closings` would count every superseded night.
 */
export async function getDepartmentById(
  restaurantId: string,
  sectionId: string,
  from: string,
  to: string,
): Promise<{
  shift: SectionShiftDayRow[]
  loss: SectionLossReasonRow[]
  staff: SectionStaffRow[]
}> {
  return txn(async (tx) => {
    // produced and closed, per day. `closed` is NULL when nothing was filed —
    // never 0, because a counted zero is a real closing.
    const shift = await tx<SectionShiftDayRow[]>`
      with made as (
        select p.prod_date as day,
               coalesce(sum(p.value), 0)::text as produced,
               count(*) filter (
                 where p.reverses_id is null
                   and not exists (select 1 from productions x where x.reverses_id = p.id)
               )::int as batches
        from productions p
        where p.restaurant_id = ${restaurantId}
          and p.section_id = ${sectionId}
          and p.prod_date between ${from}::date and ${to}::date
        group by p.prod_date
        -- A day whose every batch was voided is not a day that made ₹0.00 —
        -- it is a day with nothing on it. Left in, it also keeps the card out
        -- of its own empty state.
        having count(*) filter (
          where p.reverses_id is null
            and not exists (select 1 from productions x where x.reverses_id = p.id)
        ) > 0
      ),
      held as (
        select c.close_date as day, c.closing_value::text as closed
        from kitchen_closing_current c
        where c.restaurant_id = ${restaurantId}
          and c.section_id = ${sectionId}
          and c.close_date between ${from}::date and ${to}::date
      )
      select coalesce(made.day, held.day)::text as day,
             coalesce(made.produced, '0') as produced,
             coalesce(made.batches, 0) as batches,
             held.closed
      from made
      full outer join held on held.day = made.day
      order by 1 desc`

    // Grouped on the reason TEXT, never joined to list_options: an inline
    // addition means a reason can legitimately be a word the list has never
    // seen, and joining would silently drop those rows.
    //
    // The VALUE sums every row (the twin nets); the EVENT COUNT excludes both
    // halves, because a voided loss is not a thing that happened.
    const loss = await tx<SectionLossReasonRow[]>`
      select w.reason,
             count(*) filter (
               where w.reverses_id is null
                 and not exists (select 1 from kitchen_wastage x where x.reverses_id = w.id)
             )::int as events,
             coalesce(sum(w.value), 0)::text as value
      from kitchen_wastage w
      where w.restaurant_id = ${restaurantId}
        and w.section_id = ${sectionId}
        and w.waste_date between ${from}::date and ${to}::date
      group by w.reason
      -- ORDER ON THE NUMBER, NOT ITS TEXT. "order by 3 desc" pointed at the
      -- ::text cast in the select list, so 9.00 sorted above 100.00 and the
      -- biggest loss was not at the top — which is the entire point of this
      -- card. The having drops a reason whose every row was voided: it would
      -- otherwise render as a ₹0.00 line, and its mere presence suppresses the
      -- empty state that should have fired.
      having count(*) filter (
        where w.reverses_id is null
          and not exists (select 1 from kitchen_wastage x where x.reverses_id = w.id)
      ) > 0
      order by coalesce(sum(w.value), 0) desc, w.reason asc`

    // A NARROWED select. listRoster's STAFF_SELECT carries base_salary and
    // phone and does not filter status — and everything an RSC returns is
    // shipped to the browser. A chef has no reason to hold a cook's salary.
    const staff = await tx<SectionStaffRow[]>`
      select st.id, st.code, st.name, st.designation, st.grade, st.employment_type
      from staff st
      where st.restaurant_id = ${restaurantId}
        and st.section_id = ${sectionId}
        and st.status = 'active'
      order by st.grade asc nulls last, st.name asc`

    return { shift, loss, staff }
  })
}

/**
 * Does each leg of the money card rest on anything?
 *
 * `section_costs` cannot answer this: it COALESCEs sales and labour to 0, so
 * its own row cannot distinguish "₹0 of sales" from "no POS day has ever been
 * fetched". Each leg is therefore checked against its OWN source, and the card
 * goes unassessable per leg rather than as a whole — consumption can be real
 * while sales and labour are not, which is exactly the live state today.
 */
export async function getDepartmentEvidence(
  restaurantId: string,
  sectionCode: string,
  sectionId: string,
  from: string,
  to: string,
): Promise<{
  consumption: boolean
  sales: boolean
  labour: boolean
  liveIssues: number
  unmappedItems: number
  contractStaff: number
}> {
  return txn(async (tx) => {
    const [row] = await tx<{
      consumption: number
      sales: number
      labour: number
      live_issues: number
      unmapped: number
      contract_staff: number
    }[]>`
      select
        (select count(*)::int from section_consumption_daily d
          where d.restaurant_id = ${restaurantId} and d.section_code = ${sectionCode}
            and d.move_date between ${from}::date and ${to}::date) as consumption,

        -- ATTRIBUTABLE revenue, not "was any POS day fetched".
        --
        -- Sales reach a department only through pos_item_map → recipes →
        -- section, so the first fetched day would otherwise flip this leg true
        -- for all sixteen departments at once and hand every one of them a
        -- confident sales of 0 and a red negative margin — the exact
        -- accusation this page exists to refuse, arriving the day the POS is
        -- switched on. The question is whether THIS department can be shown to
        -- have earned anything, and only a mapped dish can answer it.
        (select count(*)::int
           from pos_lines pl
           join pos_orders o on o.id = pl.order_id
           join pos_item_map m on m.restaurant_id = pl.restaurant_id and m.pos_item_id = pl.pos_item_id
           join recipes r on r.id = m.recipe_id
          where pl.restaurant_id = ${restaurantId}
            and r.section_id = ${sectionId}
            and o.business_date between ${from}::date and ${to}::date) as sales,

        -- MIRRORS THE VIEW IT CERTIFIES. labour_cost_by_section carries
        -- "where st.employment_type <> 'contract'", so counting contract marks
        -- here would call the labour leg assessable and then read ₹0.00 off a
        -- view that deliberately excluded those people — a measurement made of
        -- an exclusion. attendance_current, not attendance, for the same
        -- reason: a correction is a new row and only the latest one counts.
        (select count(*)::int from attendance_current a
          join staff st on st.id = a.staff_id
          where st.restaurant_id = ${restaurantId} and st.section_id = ${sectionId}
            and st.employment_type <> 'contract'
            and a.att_date between ${from}::date and ${to}::date) as labour,

        (select count(*)::int from issues i
          where i.restaurant_id = ${restaurantId} and i.section_id = ${sectionId}
            and i.issue_date between ${from}::date and ${to}::date
            and i.reverses_id is null
            and not exists (select 1 from issues x where x.reverses_id = i.id)) as live_issues,

        -- how much of the POS is not mapped to a dish yet: the reason a
        -- department can show no sales on a day the restaurant clearly sold
        -- food, and a fact about the mapping queue rather than about the team
        (select count(*)::int from unmapped_pos_items u
          where u.restaurant_id = ${restaurantId}) as unmapped,

        (select count(*)::int from staff st
          where st.restaurant_id = ${restaurantId} and st.section_id = ${sectionId}
            and st.status = 'active' and st.employment_type = 'contract') as contract_staff`
    return {
      consumption: (row?.consumption ?? 0) > 0,
      sales: (row?.sales ?? 0) > 0,
      labour: (row?.labour ?? 0) > 0,
      liveIssues: row?.live_issues ?? 0,
      unmappedItems: row?.unmapped ?? 0,
      contractStaff: row?.contract_staff ?? 0,
    }
  })
}
