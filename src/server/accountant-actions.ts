'use server'

// The query loop, write side, and the period close it gates.
//
// THE MECHANISM THAT MAKES THE LOOP MATTER: a period cannot close while a
// query is open. Without that, a query is a comment box — someone types a
// question, nobody answers, the month closes anyway and the question was
// decoration. With it, the month is the deadline, and the deadline is what
// makes anyone reply.
//
// Three roles, three verbs. The ACCOUNTANT raises and resolves — they own
// the books, so they decide when an answer settles a question. The ASSIGNED
// ROLE answers, because they are the hands that touched the money. Nobody
// edits anybody else's words: `answer` is written once by the answerer and
// `question` is never rewritten at all.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { getQuery, listOpenQueries } from '@/server/accountant-queries'
import { isQueryEntity, ASSIGNABLE_ROLES } from '@/lib/query-entities'
import type {
  ClosePeriodInput,
  ClosePeriodResult,
  QueryRow,
  RaiseQueryInput,
  SaveQueryResult,
} from '@/lib/types'
import type { Role } from '@/lib/roles'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class QueryError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof QueryError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('accountant action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

/** Who is asking, checked against the DATABASE every time — retiring or
 *  re-roling a user bites on their next action, not next month. */
async function actor(allowed: Role[], what: string): Promise<{ username: string; role: Role }> {
  const user = await getSessionUser()
  if (!user) throw new QueryError('Sign in again — the session has expired')
  if (!allowed.includes(user.role)) {
    throw new QueryError(`${what} is the accountant's job — ask them, or an owner`)
  }
  return { username: user.username, role: user.role }
}

/* ── raise ─────────────────────────────────────────────────────────────── */

const RaiseSchema = z.object({
  entityType: z.string().trim().min(1, 'What is the question about?'),
  entityId: z.union([z.literal(''), z.string().regex(UUID)]),
  entityDate: z.union([z.literal(''), z.string().regex(DATE_RE)]),
  question: z.string().trim().min(3, 'Type the question').max(2000),
  assignedRole: z.string().trim(),
})

export async function raiseQuery(raw: RaiseQueryInput): Promise<SaveQueryResult> {
  try {
    const input = RaiseSchema.parse(raw)
    const who = await actor(['accountant', 'owner'], 'Raising a query')

    if (!isQueryEntity(input.entityType)) throw new QueryError('Pick what the question is about')
    // Mirrors the CHECK on queries.assigned_role. The accountant is absent
    // from that list on purpose: they ask, they do not answer.
    if (!ASSIGNABLE_ROLES.includes(input.assignedRole as Role)) {
      throw new QueryError('Pick who should answer — a query is asked OF someone')
    }

    const restaurant = await getRestaurant()
    const [row] = await sql<{ id: string }[]>`
      insert into queries (restaurant_id, entity_type, entity_id, entity_date,
                           question, assigned_role, status, raised_by)
      values (${restaurant.id}, ${input.entityType},
              ${input.entityId === '' ? null : input.entityId},
              ${input.entityDate === '' ? null : input.entityDate},
              ${input.question}, ${input.assignedRole}, 'open', ${who.username})
      returning id`
    if (!row) throw new QueryError('The query could not be saved')

    const query = await getQuery(restaurant.id, row.id)
    if (!query) throw new QueryError('Could not read the query back after saving')
    return { ok: true, query }
  } catch (e) {
    return fail(e)
  }
}

/* ── answer ────────────────────────────────────────────────────────────── */

const AnswerSchema = z.object({
  id: z.string().regex(UUID),
  answer: z.string().trim().min(1, 'Type the answer').max(2000),
})

/**
 * The assigned role answers. Managers and owners may answer anything —
 * somebody has to be able to clear a query when the person it was aimed at
 * is on leave, and a loop that stalls on one absence is a loop nobody uses.
 *
 * Answering does NOT resolve. The accountant asked the question; they decide
 * whether the answer settles it. That is the whole point of two statuses.
 */
export async function answerQuery(raw: { id: string; answer: string }): Promise<SaveQueryResult> {
  try {
    const input = AnswerSchema.parse(raw)
    const user = await getSessionUser()
    if (!user) throw new QueryError('Sign in again — the session has expired')

    const restaurant = await getRestaurant()
    const existing = await getQuery(restaurant.id, input.id)
    if (!existing) throw new QueryError('That query no longer exists')
    if (existing.status === 'resolved') throw new QueryError('That query is already resolved')

    const mayAnswer =
      user.role === existing.assigned_role || user.role === 'manager' || user.role === 'owner'
    if (!mayAnswer) {
      throw new QueryError(`This one was asked of the ${existing.assigned_role} — they answer it`)
    }

    // An answer replaces an earlier answer only while the query is still
    // unresolved; once the accountant resolves it, the words are sealed.
    const [row] = await sql<{ id: string }[]>`
      update queries
      set answer = ${input.answer}, answered_by = ${user.username},
          answered_at = now(), status = 'answered'
      where id = ${input.id} and restaurant_id = ${restaurant.id} and status <> 'resolved'
      returning id`
    if (!row) throw new QueryError('Nothing was changed — reload and try again')

    const query = await getQuery(restaurant.id, input.id)
    if (!query) throw new QueryError('Could not read the query back after saving')
    return { ok: true, query }
  } catch (e) {
    return fail(e)
  }
}

/* ── resolve ───────────────────────────────────────────────────────────── */

/**
 * Only whoever owns the books closes a question. A query may be resolved
 * without an answer typed — the fix is often a REVERSAL and a re-entry,
 * because events are immutable here, and the corrected rows are the answer.
 * The trail still shows what was asked and when it was let go.
 */
export async function resolveQuery(id: string): Promise<SaveQueryResult> {
  try {
    if (!UUID.test(id)) throw new QueryError('Malformed query id')
    const who = await actor(['accountant', 'owner'], 'Resolving a query')
    const restaurant = await getRestaurant()

    const [row] = await sql<{ id: string }[]>`
      update queries
      set status = 'resolved', resolved_by = ${who.username}, resolved_at = now()
      where id = ${id} and restaurant_id = ${restaurant.id} and status <> 'resolved'
      returning id`
    if (!row) throw new QueryError('Nothing was changed — it may already be resolved')

    const query = await getQuery(restaurant.id, id)
    if (!query) throw new QueryError('Could not read the query back after saving')
    return { ok: true, query }
  } catch (e) {
    return fail(e)
  }
}

/* ── close a period ────────────────────────────────────────────────────── */

const CloseSchema = z.object({
  periodStart: z.string().regex(DATE_RE),
  periodEnd: z.string().regex(DATE_RE),
  note: z.string().trim().max(500),
})

/**
 * THE GATE. A period cannot close while a query is open, and the refusal
 * counts them rather than waving vaguely — a number is something you can
 * finish. Answered-but-unresolved counts too: the accountant asked, so the
 * accountant decides it is settled, and closing around an unread answer is
 * the same as never asking.
 */
export async function closePeriod(raw: ClosePeriodInput): Promise<ClosePeriodResult> {
  try {
    const input = CloseSchema.parse(raw)
    const who = await actor(['accountant', 'owner'], 'Closing a period')
    if (input.periodEnd < input.periodStart) throw new QueryError('The period ends before it starts')

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const closed = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      // Re-read inside the lock: a query raised while this form was open
      // must still block the close.
      const [{ n: open }] = await tx<{ n: number }[]>`
        select count(*)::int as n from queries
        where restaurant_id = ${rid} and status <> 'resolved'`
      if (open > 0) {
        throw new QueryError(
          `${open} ${open === 1 ? 'query is' : 'queries are'} still open — resolve ${
            open === 1 ? 'it' : 'them'
          } before closing the period. A month that closes over an unanswered question closes over a wrong number.`,
        )
      }

      const [overlap] = await tx<{ period_start: string }[]>`
        select period_start::text as period_start from period_closes
        where restaurant_id = ${rid} and reopened_at is null
          and period_start <= ${input.periodEnd}::date and period_end >= ${input.periodStart}::date
        limit 1`
      if (overlap) throw new QueryError(`That overlaps the period already closed from ${overlap.period_start}`)

      const [row] = await tx<{ id: string }[]>`
        insert into period_closes (restaurant_id, period_start, period_end, closed_by, note)
        values (${rid}, ${input.periodStart}, ${input.periodEnd}, ${who.username},
                ${input.note === '' ? null : input.note})
        returning id`
      return row
    })
    if (!closed) throw new QueryError('The close could not be verified')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Reopening is an UPDATE — the only one on period_closes, and it is granted
 * on exactly three columns. It states a REASON, because reopening a closed
 * month is the kind of thing someone will ask about later.
 */
export async function reopenPeriod(periodStart: string, reason: string): Promise<ClosePeriodResult> {
  try {
    if (!DATE_RE.test(periodStart)) throw new QueryError('Malformed period')
    const clean = reason.trim()
    if (clean === '') throw new QueryError('Say why it is being reopened — a closed month reopening needs a reason')
    const who = await actor(['accountant', 'owner'], 'Reopening a period')
    const restaurant = await getRestaurant()

    const [row] = await sql<{ id: string }[]>`
      update period_closes
      set reopened_at = now(), reopened_by = ${who.username}, reopen_reason = ${clean.slice(0, 500)}
      where restaurant_id = ${restaurant.id} and period_start = ${periodStart}::date and reopened_at is null
      returning id`
    if (!row) throw new QueryError('That period is not closed')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** For the close screen: what is standing in the way, right now. */
export async function blockingQueries(): Promise<QueryRow[]> {
  const restaurant = await getRestaurant()
  return listOpenQueries(restaurant.id)
}
