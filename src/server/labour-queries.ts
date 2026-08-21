// Read side of labour. The roster order is COMPUTED, never stored:
// dept_group in fixed order, then section sort_order, then grade L1→L7,
// then name — nothing is ever renumbered. Attendance effectiveness comes
// from the attendance_current view (latest row per staff per day wins);
// money figures come from labour_cost_by_section / section_costs.
import 'server-only'
import { sql, tsql } from '@/lib/db'
import type {
  AttendanceSummaryRow, DaySheetRow, SectionCostRow, StaffRow } from '@/lib/types'

export const DEPT_ORDER = ['Management', 'Support', 'Kitchen', 'Service', 'Bar'] as const

const STAFF_SELECT = `
  select st.id, st.code, st.name, st.designation,
         st.section_id, s.code as section_code, s.name as section_name,
         s.dept_group, s.sort_order as section_sort,
         st.grade, st.employment_type,
         st.base_salary::text as base_salary, st.pay_mode,
         st.joined::text as joined, st.left_date::text as left_date,
         st.reports_to, mgr.name as reports_to_name,
         st.phone, st.emergency_name, st.emergency_phone, st.emergency_relation,
         st.status, st.created_at::text as created_at
  from staff st
  left join sections s on s.id = st.section_id
  left join staff mgr on mgr.id = st.reports_to`

const ROSTER_ORDER = `
  order by (st.section_id is null) asc,
           array_position(array['Management','Support','Kitchen','Service','Bar'], s.dept_group) asc,
           s.sort_order asc,
           st.grade asc nulls last,
           st.name asc`

/** THE ROSTER ORDER IS COMPUTED, NEVER STORED, and it is the default because
 *  a marker's place on the sheet must not move between mornings. BY SALARY is
 *  the other question — where the wage bill actually sits — and it is a
 *  different one: the biggest salary is rarely at the top of the roster.
 *
 *  Nobody with no salary sorts first under by-salary: an unset salary is a gap
 *  in the record, not a zero wage, and topping the list with it would read as
 *  the cheapest people. They sort LAST and the screen says the wage bill
 *  understates by however much they earn. */
export async function listRoster(
  restaurantId: string,
  order: 'by-department' | 'by-salary' = 'by-department',
): Promise<StaffRow[]> {
  return tsql<StaffRow[]>`
    ${sql.unsafe(STAFF_SELECT)}
    where st.restaurant_id = ${restaurantId}
    ${order === 'by-salary'
      ? sql`order by st.base_salary desc nulls last, st.name asc`
      : sql.unsafe(ROSTER_ORDER)}`
}

export async function getStaffDetail(restaurantId: string, id: string): Promise<StaffRow | null> {
  const rows = await tsql<StaffRow[]>`
    ${sql.unsafe(STAFF_SELECT)}
    where st.restaurant_id = ${restaurantId} and st.id = ${id}`
  return rows[0] ?? null
}

/** Active staff for the reports-to picker (roster order, small list) */
export async function listActiveStaff(restaurantId: string): Promise<Pick<StaffRow, 'id' | 'code' | 'name'>[]> {
  return tsql<Pick<StaffRow, 'id' | 'code' | 'name'>[]>`
    select st.id, st.code, st.name
    from staff st
    left join sections s on s.id = st.section_id
    where st.restaurant_id = ${restaurantId} and st.status = 'active'
    ${sql.unsafe(ROSTER_ORDER)}`
}

/**
 * The day sheet: every active staff member in roster order with their
 * EFFECTIVE mark for the date (attendance_current) and the full history of
 * rows for that date — corrections are visible, never hidden.
 */
export async function getDaySheet(restaurantId: string, date: string): Promise<DaySheetRow[]> {
  return tsql<DaySheetRow[]>`
    select st.id as staff_id, st.code, st.name, st.designation,
           s.name as section_name, s.dept_group, st.employment_type,
           ac.status as effective,
           ac.extra_hours::text as extra_hours,
           coalesce(
             (select json_agg(json_build_object('status', a.status, 'created_at', a.created_at::text)
                     order by a.created_at desc)
              from attendance a
              where a.staff_id = st.id and a.att_date = ${date}::date),
             '[]'::json) as history
    from staff st
    left join sections s on s.id = st.section_id
    left join attendance_current ac on ac.staff_id = st.id and ac.att_date = ${date}::date
    where st.restaurant_id = ${restaurantId} and st.status = 'active'
    ${sql.unsafe(ROSTER_ORDER)}`
}

/** Per-section costs for one month, honest zeros for quiet sections. Sales
 * and margin come straight from section_costs (fed by mapped POS lines);
 * the '—' row carries both unassigned labour and unmapped sales — loud. */
export async function getSectionCosts(restaurantId: string, monthStart: string): Promise<SectionCostRow[]> {
  const rows = await tsql<SectionCostRow[]>`
    select s.code as section_code, s.name as section_name, s.dept_group,
           coalesce(sc.consumption, 0)::text as consumption,
           coalesce(sc.labour, 0)::text as labour,
           coalesce(sc.total_cost, 0)::text as total_cost,
           coalesce(sc.sales, 0)::text as sales,
           coalesce(sc.margin, 0)::text as margin,
           coalesce(l.unassigned_marks, 0)::int as unassigned_marks,
           coalesce(l.unsalaried_marks, 0)::int as unsalaried_marks
    from sections s
    left join section_costs sc
      on sc.restaurant_id = s.restaurant_id and sc.section_code = s.code and sc.month = ${monthStart}::date
    left join labour_cost_by_section l
      on l.restaurant_id = s.restaurant_id and l.section_code = s.code and l.month = ${monthStart}::date
    where s.restaurant_id = ${restaurantId} and s.status = 'active'
    order by array_position(array['Management','Support','Kitchen','Service','Bar'], s.dept_group) asc,
             s.sort_order asc`
  const unassigned = await tsql<SectionCostRow[]>`
    select sc.section_code, sc.section_name, null as dept_group,
           sc.consumption::text as consumption, sc.labour::text as labour, sc.total_cost::text as total_cost,
           sc.sales::text as sales, sc.margin::text as margin,
           coalesce(l.unassigned_marks, 0)::int as unassigned_marks,
           coalesce(l.unsalaried_marks, 0)::int as unsalaried_marks
    from section_costs sc
    left join labour_cost_by_section l
      on l.restaurant_id = sc.restaurant_id and l.section_code = sc.section_code and l.month = sc.month
    where sc.restaurant_id = ${restaurantId} and sc.section_code = '—' and sc.month = ${monthStart}::date`
  return [...rows, ...unassigned]
}

/**
 * ATTENDANCE OVER A PERIOD — "who is absent most", which a day sheet cannot
 * answer however many days you page through.
 *
 * RANKED BY ABSENCE, never by name: a roster sorted alphabetically hides the
 * one fact this view exists to surface. Same ordering as the staff dashboard,
 * because they answer the same question at two grains.
 *
 * `absent_pct` is recomputed over the period's own totals rather than averaged
 * across months — averaging monthly percentages weights a three-day month like
 * a thirty-day one.
 */
export async function getAttendanceOverPeriod(
  restaurantId: string,
  months: string[],
): Promise<AttendanceSummaryRow[]> {
  if (months.length === 0) return []
  const rows = await tsql<AttendanceSummaryRow[]>`
    select staff_id, code, name, section_code, section_name,
           min(month)::text as month,
           sum(days_marked)::int as days_marked, sum(present)::int as present,
           sum(half)::int as half, sum(off_days)::int as off_days,
           sum(leave_days)::int as leave_days, sum(absent)::int as absent,
           case when sum(days_marked) = 0 then null
                else round(100.0 * sum(absent) / sum(days_marked), 1)::text end as absent_pct
    from attendance_summary
    where restaurant_id = ${restaurantId} and month = any(${months}::date[])
    group by staff_id, code, name, section_code, section_name
    order by absent_pct desc nulls last, absent desc, name asc`
  return rows
}
