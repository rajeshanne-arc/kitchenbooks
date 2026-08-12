// The query loop, read side — and the accountant's queue generally.
//
// Real accountants send a list of questions at month end, usually over
// WhatsApp, where they get lost. This puts the list in the data: a query is
// raised against an entry, lands on the answering role's HOME SCREEN, is
// answered there, and is marked resolved by whoever asked. Both halves stay
// on the record — the question and the answer — because in a month's time
// the answer is the only thing that explains the number.
import 'server-only'
import { sql } from '@/lib/db'
import type { BooksCompletenessRow, ClosedPeriodRow, QueryRow } from '@/lib/types'
import type { Role } from '@/lib/roles'

const QUERY_SELECT = `
  select id, entity_type, entity_id, entity_date::text as entity_date,
         question, assigned_role, status, answer,
         raised_by, raised_at::text as raised_at,
         answered_by, answered_at::text as answered_at,
         resolved_by, resolved_at::text as resolved_at
  from queries`

/** Everything still live — open or answered-but-not-resolved. This is the
 *  accountant's list and the thing that blocks a period close. */
export async function listOpenQueries(restaurantId: string): Promise<QueryRow[]> {
  return sql<QueryRow[]>`
    ${sql.unsafe(QUERY_SELECT)}
    where restaurant_id = ${restaurantId} and status <> 'resolved'
    order by (status = 'open') desc, raised_at asc`
}

/** The whole trail, newest first — resolved ones included, because the
 *  answer to a question asked in March is what explains March. */
export async function listQueries(restaurantId: string, limit = 100): Promise<QueryRow[]> {
  return sql<QueryRow[]>`
    ${sql.unsafe(QUERY_SELECT)}
    where restaurant_id = ${restaurantId}
    order by raised_at desc
    limit ${limit}`
}

export async function getQuery(restaurantId: string, id: string): Promise<QueryRow | null> {
  const rows = await sql<QueryRow[]>`
    ${sql.unsafe(QUERY_SELECT)}
    where restaurant_id = ${restaurantId} and id = ${id}`
  return rows[0] ?? null
}

/** What THIS role is being asked. Managers and owners also see what they
 *  are covering for: a question nobody can answer is a question that never
 *  gets answered, and the loop stalls on the one person who is on leave. */
export async function listQueriesForRole(restaurantId: string, role: Role): Promise<QueryRow[]> {
  const roles: Role[] = role === 'owner' || role === 'manager' ? [role, 'manager', 'owner'] : [role]
  return sql<QueryRow[]>`
    ${sql.unsafe(QUERY_SELECT)}
    where restaurant_id = ${restaurantId}
      and status = 'open'
      and assigned_role = any(${roles})
    order by raised_at asc`
}

/** For the badge. Zero wears nothing — an absence is quieter than a "0". */
export async function countOpenQueriesForRole(restaurantId: string, role: Role): Promise<number> {
  const roles: Role[] = role === 'owner' || role === 'manager' ? [role, 'manager', 'owner'] : [role]
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from queries
    where restaurant_id = ${restaurantId} and status = 'open' and assigned_role = any(${roles})`
  return row?.n ?? 0
}

/** books_completeness, verbatim. The view decides what is worth saying and
 *  how loudly; this page never invents a severity of its own. */
export async function getBooksCompleteness(restaurantId: string): Promise<BooksCompletenessRow[]> {
  return sql<BooksCompletenessRow[]>`
    select severity, what, n::int as n
    from books_completeness
    where restaurant_id = ${restaurantId}
    order by array_position(array['STOPS THE SUM','MAKES IT DOUBTFUL','NOTED'], severity), what`
}

/** Closed periods — reopened ones fall out of the view, so this is what is
 *  shut right now. */
export async function listClosedPeriods(restaurantId: string): Promise<ClosedPeriodRow[]> {
  return sql<ClosedPeriodRow[]>`
    select period_start::text as period_start, period_end::text as period_end,
           closed_at::text as closed_at, closed_by
    from closed_periods
    where restaurant_id = ${restaurantId}
    order by period_start desc`
}

/** Whether a date falls inside a period that is currently closed. */
export async function isDateClosed(restaurantId: string, dateISO: string): Promise<boolean> {
  const [row] = await sql<{ closed: boolean }[]>`
    select exists (
      select 1 from closed_periods
      where restaurant_id = ${restaurantId}
        and ${dateISO}::date between period_start and period_end
    ) as closed`
  return row?.closed ?? false
}
