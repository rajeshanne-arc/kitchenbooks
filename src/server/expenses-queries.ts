// Read side of the manager's staff group: expenses, expenses_by_category,
// and the wages analytics — labour by section for a month, attendance
// marks, and the honesty pills (unassigned_marks / unsalaried_marks, same
// law as uncosted_lines: surface whenever non-zero).
import 'server-only'
import { sql } from '@/lib/db'
import type { AttendanceStatus, ExpenseCategoryMonthRow, ExpenseRow, LabourMonthRow } from '@/lib/types'

const EXPENSE_SELECT = `
  select e.id, e.expense_date::text as expense_date, e.category, e.payee,
         e.amount::text as amount, e.paid_via, e.note, e.reverses_id,
         (e.reverses_id is not null) as is_reversal,
         exists (select 1 from expenses x where x.reverses_id = e.id) as is_voided,
         e.entered_by, e.created_at::text as created_at
  from expenses e`

export async function getExpense(restaurantId: string, id: string): Promise<ExpenseRow | null> {
  const rows = await sql<ExpenseRow[]>`
    ${sql.unsafe(EXPENSE_SELECT)}
    where e.restaurant_id = ${restaurantId} and e.id = ${id}`
  return rows[0] ?? null
}

export async function listExpenses(restaurantId: string, limit = 40): Promise<ExpenseRow[]> {
  return sql<ExpenseRow[]>`
    ${sql.unsafe(EXPENSE_SELECT)}
    where e.restaurant_id = ${restaurantId}
    order by e.expense_date desc, e.created_at desc
    limit ${limit}`
}

/** One month's expenses by category, straight from expenses_by_category. */
export async function getExpensesByCategory(restaurantId: string, monthStart: string): Promise<ExpenseCategoryMonthRow[]> {
  return sql<ExpenseCategoryMonthRow[]>`
    select category, month::text as month, amount::text as amount
    from expenses_by_category
    where restaurant_id = ${restaurantId} and month = ${monthStart}::date
    order by amount desc`
}

/** Labour cost per section for a month from labour_cost_by_section — the
 * NULL-section row is real money on nobody's section; render it LAST and
 * loud, never dropped. */
export async function getLabourMonth(restaurantId: string, monthStart: string): Promise<LabourMonthRow[]> {
  return sql<LabourMonthRow[]>`
    select l.section_code, l.section_name, s.dept_group,
           coalesce(l.labour_cost, 0)::text as labour_cost,
           coalesce(l.unassigned_marks, 0)::int as unassigned_marks,
           coalesce(l.unsalaried_marks, 0)::int as unsalaried_marks
    from labour_cost_by_section l
    left join sections s on s.restaurant_id = l.restaurant_id and s.code = l.section_code
    where l.restaurant_id = ${restaurantId} and l.month = ${monthStart}::date
    order by (l.section_code is null) asc,
             array_position(array['Management','Support','Kitchen','Service','Bar'], s.dept_group) asc,
             s.sort_order asc`
}

/** Attendance marks by status for a month (latest row per staff per day
 * wins — attendance_current). */
export async function getAttendanceMonthSummary(
  restaurantId: string,
  monthStart: string,
): Promise<{ status: AttendanceStatus; marks: number }[]> {
  return sql<{ status: AttendanceStatus; marks: number }[]>`
    select a.status, count(*)::int as marks
    from attendance_current a
    join staff st on st.id = a.staff_id
    where st.restaurant_id = ${restaurantId}
      and date_trunc('month', a.att_date)::date = ${monthStart}::date
    group by a.status
    order by count(*) desc`
}
