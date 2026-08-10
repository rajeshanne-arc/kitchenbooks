// Read side of labour. The roster order is COMPUTED, never stored:
// dept_group in fixed order, then section sort_order, then grade L1→L7,
// then name — nothing is ever renumbered. Attendance effectiveness comes
// from the attendance_current view (latest row per staff per day wins);
// money figures come from labour_cost_by_section / section_costs.
import 'server-only'
import { sql } from '@/lib/db'
import type { DaySheetRow, SectionCostRow, StaffRow } from '@/lib/types'

export const DEPT_ORDER = ['Management', 'Support', 'Kitchen', 'Service', 'Bar'] as const

const STAFF_SELECT = `
  select st.id, st.code, st.name, st.designation,
         st.section_id, s.code as section_code, s.name as section_name,
         s.dept_group, s.sort_order as section_sort,
         st.grade, st.employment_type,
         st.base_salary::text as base_salary, st.pay_mode,
         st.joined::text as joined, st.left_date::text as left_date,
         st.reports_to, mgr.name as reports_to_name,
         st.phone, st.status, st.created_at::text as created_at
  from staff st
  left join sections s on s.id = st.section_id
  left join staff mgr on mgr.id = st.reports_to`

const ROSTER_ORDER = `
  order by (st.section_id is null) asc,
           array_position(array['Management','Support','Kitchen','Service','Bar'], s.dept_group) asc,
           s.sort_order asc,
           st.grade asc nulls last,
           st.name asc`

export async function listRoster(restaurantId: string): Promise<StaffRow[]> {
  return sql<StaffRow[]>`
    ${sql.unsafe(STAFF_SELECT)}
    where st.restaurant_id = ${restaurantId}
    ${sql.unsafe(ROSTER_ORDER)}`
}

export async function getStaffDetail(restaurantId: string, id: string): Promise<StaffRow | null> {
  const rows = await sql<StaffRow[]>`
    ${sql.unsafe(STAFF_SELECT)}
    where st.restaurant_id = ${restaurantId} and st.id = ${id}`
  return rows[0] ?? null
}

/** Active staff for the reports-to picker (roster order, small list) */
export async function listActiveStaff(restaurantId: string): Promise<Pick<StaffRow, 'id' | 'code' | 'name'>[]> {
  return sql<Pick<StaffRow, 'id' | 'code' | 'name'>[]>`
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
  return sql<DaySheetRow[]>`
    select st.id as staff_id, st.code, st.name, st.designation,
           s.name as section_name, s.dept_group, st.employment_type,
           ac.status as effective,
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

/** Per-section costs for one month, honest zeros for quiet sections. */
export async function getSectionCosts(restaurantId: string, monthStart: string): Promise<SectionCostRow[]> {
  const rows = await sql<SectionCostRow[]>`
    select s.code as section_code, s.name as section_name, s.dept_group,
           coalesce(sc.consumption, 0)::text as consumption,
           coalesce(sc.labour, 0)::text as labour,
           coalesce(sc.total_cost, 0)::text as total_cost,
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
  const unassigned = await sql<SectionCostRow[]>`
    select sc.section_code, sc.section_name, null as dept_group,
           sc.consumption::text as consumption, sc.labour::text as labour, sc.total_cost::text as total_cost,
           coalesce(l.unassigned_marks, 0)::int as unassigned_marks,
           coalesce(l.unsalaried_marks, 0)::int as unsalaried_marks
    from section_costs sc
    left join labour_cost_by_section l
      on l.restaurant_id = sc.restaurant_id and l.section_code = sc.section_code and l.month = sc.month
    where sc.restaurant_id = ${restaurantId} and sc.section_code = '—' and sc.month = ${monthStart}::date`
  return [...rows, ...unassigned]
}
