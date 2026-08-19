// The staff dashboard's reads. Four views the migration publishes, plus the
// two honesty columns labour_cost_by_section already had.
//
// A GROUP IS A SUBJECT, NOT A PERSON. This dashboard answers about PEOPLE —
// what they cost, who is on the roster, who is absent, who owes an advance —
// and deliberately not about rent or electricity, which are overheads and a
// different P&L line.
//
// ALL THREE KINDS OF LABOUR, because pnl_monthly already treats them as one:
// salaried wages, contract vendors and casual day hands. A dashboard showing
// only payroll would understate the wage bill by however much of it walks in
// without a contract.

import 'server-only'
import { txn } from '@/lib/db'
import type {
  AdvanceOutstandingRow,
  AttendanceSummaryRow,
  HeadcountRow,
  LabourSummaryRow,
  SectionLabourRow,
} from '@/lib/types'

/**
 * Everything the dashboard needs, in ONE transaction.
 *
 * Six reads at three round trips each is eighteen crossings of the Mumbai
 * link; grouped they cost one transaction. Never a `tsql` inside this
 * callback — that opens a second connection while holding the first, which is
 * the max:4 deadlock in a new costume and a gate fails on it.
 */
export async function getStaffDashboard(
  restaurantId: string,
  months: string[],
  reportMonth: string,
): Promise<{
  labour: LabourSummaryRow[]
  attendance: AttendanceSummaryRow[]
  advances: AdvanceOutstandingRow[]
  headcount: HeadcountRow[]
  bySection: SectionLabourRow[]
  unposted: { id: string; code: string; name: string }[]
}> {
  return txn(async (tx) => {
    // MONTHLY, and read per month rather than summed in SQL: a month with no
    // labour has NO ROW, and coalescing it to zero here would turn "nobody was
    // paid because nobody marked attendance" into "nobody was paid".
    const labour = await tx<LabourSummaryRow[]>`
      select month::text as month,
             wages::text as wages,
             contract::text as contract,
             casual::text as casual,
             total_labour::text as total_labour,
             revenue::text as revenue,
             labour_pct_of_sales::text as labour_pct_of_sales,
             active_heads::int as active_heads,
             cost_per_head::text as cost_per_head
      from labour_summary
      where restaurant_id = ${restaurantId} and month = any(${months}::date[])
      order by month asc`

    // RANKED BY ABSENCE, not by name. A roster sorted alphabetically hides the
    // one fact this card exists to surface.
    const attendance = await tx<AttendanceSummaryRow[]>`
      select staff_id, code, name, section_code, section_name, month::text as month,
             days_marked::int as days_marked, present::int as present, half::int as half,
             off_days::int as off_days, leave_days::int as leave_days, absent::int as absent,
             absent_pct::text as absent_pct
      from attendance_summary
      where restaurant_id = ${restaurantId} and month = any(${months}::date[])
      order by absent_pct desc nulls last, absent desc, name asc`

    const advances = await tx<AdvanceOutstandingRow[]>`
      select staff_id, code, name,
             given::text as given, recovered::text as recovered,
             outstanding::text as outstanding, last_advance::text as last_advance
      from advances_outstanding
      where restaurant_id = ${restaurantId} and outstanding <> 0
      order by outstanding desc`

    // NOT period-scoped, and it cannot be: a headcount is a fact about now,
    // not about a range. The card says so rather than implying otherwise.
    const headcount = await tx<HeadcountRow[]>`
      select section_code, section_name, dept_group, employment_type,
             heads::int as heads, no_salary_set::int as no_salary_set,
             monthly_salary_bill::text as monthly_salary_bill
      from headcount_by_section
      where restaurant_id = ${restaurantId}
      order by heads desc, section_name asc`

    const bySection = await tx<SectionLabourRow[]>`
      select section_code, section_name,
             coalesce(labour_cost, 0)::text as labour,
             unassigned_marks::int as unassigned_marks,
             unsalaried_marks::int as unsalaried_marks
      from labour_cost_by_section
      where restaurant_id = ${restaurantId} and month = ${reportMonth}::date
      order by labour_cost desc`

    // A person posted nowhere cannot be filled into attendance and would be
    // paid nothing — the completeness card's sharpest row.
    const unposted = await tx<{ id: string; code: string; name: string }[]>`
      select id, code, name from staff
      where restaurant_id = ${restaurantId} and status = 'active' and section_id is null
      order by code asc`

    return { labour, attendance, advances, headcount, bySection, unposted }
  })
}

/** Is today marked at all? One question, one number — the card asks whether
 *  the day's attendance has been taken, not who was there. */
export async function attendanceTakenOn(
  restaurantId: string,
  date: string,
): Promise<{ marked: number; active: number }> {
  return txn(async (tx) => {
    const [row] = await tx<{ marked: number; active: number }[]>`
      select
        (select count(*)::int from attendance_current a
          join staff st on st.id = a.staff_id
          where st.restaurant_id = ${restaurantId} and a.att_date = ${date}::date) as marked,
        (select count(*)::int from staff
          where restaurant_id = ${restaurantId} and status = 'active'
            and employment_type <> 'contract') as active`
    return { marked: row?.marked ?? 0, active: row?.active ?? 0 }
  })
}
