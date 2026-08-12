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
import { assertAccount } from '@/server/accounts-queries'
import type {
  ClosePeriodInput,
  ClosePeriodResult,
  QueryRow,
  RaiseQueryInput,
  SaveQueryResult,
  SaveWithholdingInput,
  SaveWithholdingResult,
  StaffFundInput,
  StaffFundResult,
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

/* ── withholdings ──────────────────────────────────────────────────────── */

const WithholdingSchema = z.object({
  date: z.string().regex(DATE_RE),
  party: z.string().trim().min(1, 'Who was it withheld from?').max(120),
  entityType: z.string().trim().max(40),
  regimeCode: z.string().trim().max(40),
  baseAmount: z.string().regex(/^\d{1,11}(\.\d{1,2})?$/, 'plain amount'),
  amount: z.string().regex(/^\d{1,11}(\.\d{1,2})?$/, 'plain amount'),
  note: z.string().trim().max(300),
})

/**
 * RECORD WHAT WAS WITHHELD. NEVER COMPUTE A RATE.
 *
 * This is the global rule of the phase in one function. TDS in India, PAYG
 * withholding in Australia, backup withholding in the US — every country
 * has the shape (someone kept part of a payment and owes it to a revenue
 * authority) and no two agree on the rates, the thresholds or the codes.
 * The app captures the SHAPE: who, how much of what, under which code the
 * customer names, and whether it has been deposited yet.
 *
 * rate_pct is therefore DERIVED FOR DISPLAY from the two amounts actually
 * entered — it is what the deduction worked out to, never a rate this app
 * applied to arrive at a number. If it were an input the next question
 * would be "which rate applies?", and answering that is filing advice.
 */
export async function saveWithholding(raw: SaveWithholdingInput): Promise<SaveWithholdingResult> {
  try {
    const input = WithholdingSchema.parse(raw)
    const who = await actor(['accountant', 'owner'], 'Recording a withholding')

    const base = Number(input.baseAmount)
    const amount = Number(input.amount)
    if (!(base > 0)) throw new QueryError('The amount it was taken from must be more than zero')
    if (!(amount > 0)) throw new QueryError('The amount withheld must be more than zero')
    if (amount > base) throw new QueryError('More was withheld than was paid — check the two figures')

    // Stated to 2dp, and only ever as a consequence of the two numbers above.
    const ratePct = ((amount / base) * 100).toFixed(2)

    const restaurant = await getRestaurant()
    const [row] = await sql<{ id: string }[]>`
      insert into withholdings (restaurant_id, wh_date, entity_type, party, regime_code,
                                base_amount, rate_pct, amount, note, entered_by)
      values (${restaurant.id}, ${input.date},
              ${input.entityType === '' ? 'payment' : input.entityType},
              ${input.party},
              ${input.regimeCode === '' ? null : input.regimeCode},
              ${input.baseAmount}::numeric, ${ratePct}::numeric, ${input.amount}::numeric,
              ${input.note === '' ? null : input.note}, ${who.username})
      returning id`
    if (!row) throw new QueryError('The withholding could not be saved')

    const [saved] = await sql<import('@/lib/types').WithholdingRow[]>`
      select id, wh_date::text as wh_date, entity_type, party, regime_code,
             base_amount::text as base_amount, rate_pct::text as rate_pct,
             amount::text as amount, deposited_on::text as deposited_on,
             challan_ref, note, entered_by
      from withholdings where id = ${row.id}`
    if (!saved) throw new QueryError('Could not read the withholding back after saving')
    return { ok: true, withholding: saved }
  } catch (e) {
    return fail(e)
  }
}

/** Marking it deposited. The three columns with an UPDATE grant, and no
 *  others — the amounts are what was withheld and never move. */
export async function markWithholdingDeposited(
  id: string,
  depositedOn: string,
  reference: string,
  accountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!UUID.test(id)) throw new QueryError('Malformed id')
    if (!DATE_RE.test(depositedOn)) throw new QueryError('When was it deposited?')
    await actor(['accountant', 'owner'], 'Recording a deposit')
    const restaurant = await getRestaurant()
    // A deposit is money leaving a real account today, so it names one like
    // every other money form. Until the migration that added this column, a
    // deposited challan reached money_movements with a NULL account: it could
    // never be reconciled and it sat in the unaccounted count forever.
    const account = await assertAccount(
      restaurant.id,
      accountId,
      'the account the challan was paid from',
    )
    const [row] = await sql<{ id: string }[]>`
      update withholdings
      set deposited_on = ${depositedOn}::date,
          account_id = ${account},
          challan_ref = ${reference.trim() === '' ? null : reference.trim().slice(0, 120)}
      where id = ${id} and restaurant_id = ${restaurant.id}
      returning id`
    if (!row) throw new QueryError('That withholding no longer exists')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/* ── the staff fund ────────────────────────────────────────────────────── */

const FundSchema = z.object({
  date: z.string().regex(DATE_RE),
  direction: z.enum(['collected', 'distributed']),
  amount: z.string().regex(/^\d{1,11}(\.\d{1,2})?$/, 'plain amount'),
  source: z.string().trim().max(120),
  accountId: z.string().trim(),
  note: z.string().trim().max(300),
})

/**
 * The staff fund is a LIABILITY, not income: money collected on behalf of
 * the staff, less what has been handed to them. Whether the local word is
 * "service charge" or "tips" changes nothing here — the shape is the same,
 * which is why `source` is free text on the row rather than a hardcoded
 * concept in the schema.
 *
 * A distribution moves real money, so it names the account it left, exactly
 * like every other payment in the app.
 */
export async function saveStaffFundMovement(raw: StaffFundInput): Promise<StaffFundResult> {
  try {
    const input = FundSchema.parse(raw)
    const who = await actor(['accountant', 'owner'], 'Recording a staff fund movement')
    if (!(Number(input.amount) > 0)) throw new QueryError('The amount must be more than zero')

    const restaurant = await getRestaurant()
    const accountId = await assertAccount(
      restaurant.id,
      input.accountId,
      input.direction === 'collected'
        ? 'the account this landed in'
        : 'the account it was paid out of',
    )

    const [row] = await sql<{ id: string }[]>`
      insert into staff_fund_movements (restaurant_id, move_date, direction, amount,
                                        source, account_id, note, entered_by)
      values (${restaurant.id}, ${input.date}, ${input.direction}, ${input.amount}::numeric,
              ${input.source === '' ? null : input.source}, ${accountId},
              ${input.note === '' ? null : input.note}, ${who.username})
      returning id`
    if (!row) throw new QueryError('The movement could not be saved')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/* ── the one tax assumption, made configurable ─────────────────────────── */

/**
 * Whether input tax on purchases is a CREDIT or a COST.
 *
 * This restaurant is on a scheme with no input credit, so the tax it pays
 * suppliers is part of what the food cost — but that is THIS restaurant's
 * situation, not a fact about the world, and a different scheme or a
 * different country flips it. So it is a setting, stated on the Tax screen,
 * and the screen says which way it is set rather than quietly assuming.
 *
 * Default: NOT creditable. That is the conservative reading — it treats the
 * tax as spent, which is true until someone confirms it can be reclaimed.
 */
export async function setInputTaxCreditable(creditable: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await actor(['accountant', 'owner'], 'Changing the tax treatment')
    const restaurant = await getRestaurant()
    await sql`
      insert into settings (restaurant_id, key, value)
      values (${restaurant.id}, 'input_tax_creditable', ${creditable ? 'true' : 'false'})
      on conflict (restaurant_id, key) do update set value = excluded.value`
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
