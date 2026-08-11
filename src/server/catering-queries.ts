// Catering. The event is the object; its cost is not typed anywhere — it is
// the sum of the issues STAMPED to it plus its own expenses, and
// catering_summary does that arithmetic.
//
// NO MENU PRICE ANYWHERE. A catering job is costed from what actually left
// the store, not from what the dishes would have sold for.
import 'server-only'
import { sql } from '@/lib/db'
import type { CateringEventDetail, CateringSummaryRow } from '@/lib/types'

const SUMMARY = `
  select catering_id, event_date::text as event_date, name, customer, covers,
         revenue_collected::text as revenue_collected,
         food_cost::text as food_cost,
         other_expenses::text as other_expenses,
         total_cost::text as total_cost,
         margin::text as margin
  from catering_summary`

export async function listCateringEvents(restaurantId: string, limit = 40): Promise<CateringSummaryRow[]> {
  return sql<CateringSummaryRow[]>`
    ${sql.unsafe(SUMMARY)}
    where restaurant_id = ${restaurantId}
    order by event_date desc
    limit ${limit}`
}

export async function getCateringEvent(
  restaurantId: string,
  id: string,
): Promise<CateringEventDetail | null> {
  const rows = await sql<CateringSummaryRow[]>`
    ${sql.unsafe(SUMMARY)}
    where restaurant_id = ${restaurantId} and catering_id = ${id}`
  const head = rows[0]
  if (!head) return null

  const [extra] = await sql<{ contact: string | null; payment_mode: string | null; note: string | null }[]>`
    select contact, payment_mode, note from catering_events
    where id = ${id} and restaurant_id = ${restaurantId}`

  const issues = await sql<
    { id: string; issue_date: string; section_name: string; line_count: number; value: string }[]
  >`
    select i.id, i.issue_date::text as issue_date, s.name as section_name,
           count(l.id)::int as line_count,
           coalesce(sum(l.value), 0)::text as value
    from issues i
    join sections s on s.id = i.section_id
    left join issue_lines l on l.issue_id = i.id
    where i.restaurant_id = ${restaurantId} and i.catering_id = ${id}
    group by i.id, i.issue_date, s.name
    order by i.issue_date asc`

  const expenses = await sql<
    { id: string; description: string | null; amount: string; paid_via: string | null }[]
  >`
    select id, description, amount::text as amount, paid_via
    from catering_expenses where catering_id = ${id}
    order by amount desc`

  return { ...head, ...(extra ?? { contact: null, payment_mode: null, note: null }), issues, expenses }
}

/** Events an issue may be stamped to — open enough to still be costed. */
export async function listCateringForPicker(
  restaurantId: string,
): Promise<{ id: string; name: string; event_date: string }[]> {
  return sql<{ id: string; name: string; event_date: string }[]>`
    select id, name, event_date::text as event_date
    from catering_events
    where restaurant_id = ${restaurantId} and reverses_id is null
    order by event_date desc
    limit 30`
}
