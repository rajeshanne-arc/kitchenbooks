'use server'

// Bank reconciliation, write side: a statement is imported, a line is
// matched, and a match can be taken back.
//
// A MATCH IS AN ASSERTION, NOT AN EVENT — which is why unmatching is a
// DELETE and not a reversal row. Everything else in this app is append-only
// because it records something that HAPPENED: money moved, goods arrived,
// somebody worked a day. A match records only that a human believes two
// rows are the same transaction. Being wrong about that is not history, it
// is a mistake, and the honest fix is to remove it rather than to leave a
// wrong claim on the record beside a correcting one.
//
// `reconciliation_matches` carries UNIQUE(statement_line_id), so one line
// holds one match; unmatching frees both sides to be matched again.
//
// A statement is a PROVIDER'S CLAIM, not a correction to the books. Nothing
// in this file writes a payment, edits an amount or moves a balance — the
// import records what the bank said, and the match records that a human
// decided which of our rows it was.

import { z } from 'zod'
import { sql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { AccountRefusal, assertAccount } from '@/server/accounts-queries'
import {
  findUnmatchedMovement,
  getStatement,
  getStatementLineForMatch,
} from '@/server/reconciliation-queries'
import type { ImportStatementInput, ImportStatementResult, MatchInput, ReconcileResult } from '@/lib/types'
import type { Role } from '@/lib/roles'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** signed: money out of the account is negative, exactly as money_movements holds it */
const SIGNED_MONEY = /^-?\d{1,11}(\.\d{1,2})?$/

class ReconcileError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ReconcileError) return { ok: false, error: e.message }
  if (e instanceof AccountRefusal) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('reconciliation action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

/** Who is asking, checked against the DATABASE every time — retiring or
 *  re-roling a user bites on their next action, not next month. */
async function actor(allowed: Role[], what: string): Promise<{ username: string; role: Role }> {
  const user = await getSessionUser()
  if (!user) throw new ReconcileError('Sign in again — the session has expired')
  if (!allowed.includes(user.role)) {
    throw new ReconcileError(`${what} is the accountant's job — ask them, or an owner`)
  }
  return { username: user.username, role: user.role }
}

/** '2026-02-30' passes the regex and is not a day. Checked by round-trip
 *  because a statement pasted from a spreadsheet is exactly where a date
 *  like that comes from. */
function isRealDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(`${iso}T00:00:00`)
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d
}

/* ── import ────────────────────────────────────────────────────────────── */

const ImportSchema = z.object({
  accountId: z.string().trim(),
  periodStart: z.string().trim(),
  periodEnd: z.string().trim(),
  openingBalance: z.string().trim(),
  closingBalance: z.string().trim(),
  note: z.string().trim().max(500),
  lines: z
    .array(
      z.object({
        date: z.string().trim(),
        description: z.string().trim().max(300),
        reference: z.string().trim().max(120),
        amount: z.string().trim(),
      }),
    )
    .max(2000, 'That is more rows than one statement period holds — split the paste'),
})

/**
 * One statement, one transaction: the header and every line together or
 * neither. Half a statement is worse than none — the lines that landed would
 * be reconciled against and the ones that did not would look like money the
 * bank never saw.
 *
 * The lines are refused BY ROW NUMBER. A statement is pasted from a screen
 * the accountant is still looking at, so "row 14 is not a date" is a thing
 * they can fix in seconds; silently dropping row 14 is a discrepancy they
 * hunt for at midnight three weeks later.
 */
export async function importStatement(raw: ImportStatementInput): Promise<ImportStatementResult> {
  try {
    const input = ImportSchema.parse(raw)
    const who = await actor(['accountant', 'owner'], 'Importing a statement')

    if (!isRealDate(input.periodStart) || !isRealDate(input.periodEnd)) {
      throw new ReconcileError('Give the period the statement covers, as two real dates')
    }
    if (input.periodEnd < input.periodStart) throw new ReconcileError('The period ends before it starts')

    for (const [label, value] of [
      ['opening balance', input.openingBalance],
      ['closing balance', input.closingBalance],
    ] as const) {
      if (value !== '' && !SIGNED_MONEY.test(value)) {
        throw new ReconcileError(`The ${label} is not a plain amount — digits, at most two decimals, minus for an overdrawn account`)
      }
    }

    if (input.lines.length === 0) {
      throw new ReconcileError(
        'Paste the statement rows — a statement with no lines has nothing to reconcile against',
      )
    }

    // Every row checked before anything is written, and named when it fails.
    const lines = input.lines.map((l, i) => {
      const row = i + 1
      if (!isRealDate(l.date)) {
        throw new ReconcileError(`Row ${row}: "${l.date.slice(0, 20)}" is not a date. Dates are YYYY-MM-DD.`)
      }
      if (!SIGNED_MONEY.test(l.amount)) {
        throw new ReconcileError(
          `Row ${row}: "${l.amount.slice(0, 20)}" is not an amount. Money out of the account is negative.`,
        )
      }
      return l
    })

    const restaurant = await getRestaurant()
    const accountId = await assertAccount(restaurant.id, input.accountId, 'the account this statement is for')

    const statementId = await txn(async (tx) => {
      // The database refuses a duplicate period on the same account anyway;
      // asking first is only so the refusal is a sentence rather than a
      // constraint name.
      const [clash] = await tx<{ id: string }[]>`
        select id from statements
        where restaurant_id = ${restaurant.id} and account_id = ${accountId}
          and period_start = ${input.periodStart}::date and period_end = ${input.periodEnd}::date`
      if (clash) {
        throw new ReconcileError(
          'That account already has a statement for exactly this period. A statement is imported once; if this one is different, import it under the period it actually covers.',
        )
      }

      const [statement] = await tx<{ id: string }[]>`
        insert into statements (restaurant_id, account_id, period_start, period_end,
                                opening_balance, closing_balance, note, imported_by)
        values (${restaurant.id}, ${accountId}, ${input.periodStart}, ${input.periodEnd},
                ${input.openingBalance === '' ? null : input.openingBalance}::numeric,
                ${input.closingBalance === '' ? null : input.closingBalance}::numeric,
                ${input.note === '' ? null : input.note}, ${who.username})
        returning id`
      if (!statement) throw new ReconcileError('The statement could not be saved')

      const rows = lines.map((l) => ({
        statement_id: statement.id,
        stmt_date: l.date,
        description: l.description === '' ? null : l.description,
        reference: l.reference === '' ? null : l.reference,
        amount: l.amount,
      }))
      await tx`insert into statement_lines ${tx(rows, 'statement_id', 'stmt_date', 'description', 'reference', 'amount')}`

      // Read back inside the transaction: if the count the view reports is
      // not the count that was pasted, nothing at all is written.
      const [check] = await tx<{ statement_lines: number }[]>`
        select rs.statement_lines::int as statement_lines
        from reconciliation_status rs
        where rs.statement_id = ${statement.id}`
      if (!check || check.statement_lines !== lines.length) {
        throw new ReconcileError('The lines did not all land — nothing was imported')
      }

      return statement.id
    })

    const saved = await getStatement(restaurant.id, statementId)
    if (!saved) throw new ReconcileError('Could not read the statement back after saving')
    return { ok: true, statementId }
  } catch (e) {
    return fail(e)
  }
}

/* ── match ─────────────────────────────────────────────────────────────── */

const MatchSchema = z.object({
  statementLineId: z.string().trim(),
  entityType: z.string().trim().min(1).max(40),
  entityId: z.string().trim(),
  note: z.string().trim().max(300),
})

/**
 * One statement line, one movement — until somebody unmatches it.
 *
 * The three refusals are all about the row NOT being written twice or
 * wrongly: a line already matched stays as it was decided, a movement
 * already matched cannot be spent again, and neither may be borrowed from
 * another account. The entity is checked against unmatched_movements rather
 * than a list of entity types kept here — the view already knows every table
 * that moves money, and a hardcoded copy of that list goes stale silently.
 *
 * Amounts are NOT required to agree, and that is deliberate. A bank fee
 * bundled into a transfer, a rounding on a settlement, a part payment — an
 * accountant matches those with their eyes open. The screen shows both
 * figures and their difference before the button; deciding is theirs.
 */
export async function matchStatementLine(raw: MatchInput): Promise<ReconcileResult> {
  try {
    const input = MatchSchema.parse(raw)
    const who = await actor(['accountant', 'owner'], 'Matching a statement line')
    if (!UUID.test(input.statementLineId)) throw new ReconcileError('Malformed statement line')
    if (!UUID.test(input.entityId)) throw new ReconcileError('Malformed movement')

    const restaurant = await getRestaurant()

    const line = await getStatementLineForMatch(restaurant.id, input.statementLineId)
    if (!line) throw new ReconcileError('That statement line no longer exists')
    if (line.matched) {
      throw new ReconcileError('That line is already matched — unmatch it first, or reload the screen')
    }

    const movement = await findUnmatchedMovement(
      restaurant.id,
      line.account_id,
      input.entityType,
      input.entityId,
    )
    if (!movement) {
      throw new ReconcileError(
        'That entry is not available to match: it belongs to another account, or somebody has already matched it. Reload the screen to see what is left.',
      )
    }

    const [row] = await sql<{ id: string }[]>`
      insert into reconciliation_matches (restaurant_id, statement_line_id, entity_type, entity_id,
                                          matched_by, note)
      values (${restaurant.id}, ${input.statementLineId}, ${input.entityType}, ${input.entityId},
              ${who.username}, ${input.note === '' ? null : input.note})
      returning id`
    if (!row) throw new ReconcileError('The match could not be saved')

    const [saved] = await sql<{ id: string }[]>`
      select m.id from reconciliation_matches m where m.id = ${row.id}`
    if (!saved) throw new ReconcileError('Could not read the match back after saving')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Take a match back.
 *
 * A DELETE, and the only one in the accounting side of this app. The rule
 * everywhere else — never UPDATE, never DELETE, correct with a reversal —
 * exists because those tables hold EVENTS, and an event that happened
 * cannot be made not to have happened. A match holds a JUDGEMENT: this
 * statement line is that movement. A judgement that turns out to be wrong
 * was never true, so there is nothing to reverse; leaving it on the record
 * beside a correction would assert two contradictory things at once and
 * make `unmatched_lines` count wrong forever.
 *
 * This is the same shape as the `recipe_lines` DELETE exception: removing
 * an ingredient from a card is editing a description, not erasing history.
 *
 * Deleting frees BOTH sides — the statement line and the movement — to be
 * matched again, which is the whole point: an unmatch happens because
 * somebody is about to make a better one.
 */
export async function unmatchStatementLine(statementLineId: string): Promise<ReconcileResult> {
  try {
    if (!UUID.test(statementLineId)) throw new ReconcileError('Malformed statement line')
    await actor(['accountant', 'owner'], 'Unmatching a statement line')
    const restaurant = await getRestaurant()

    const [row] = await sql<{ id: string }[]>`
      delete from reconciliation_matches
      where restaurant_id = ${restaurant.id} and statement_line_id = ${statementLineId}
      returning id`
    if (!row) throw new ReconcileError('That line was not matched — reload the screen')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
