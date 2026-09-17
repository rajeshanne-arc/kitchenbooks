'use server'

// Payroll, write side. THREE HANDS, and the split is the point:
//
//   the MANAGER marks attendance    — operational, daily, already built
//   the ACCOUNTANT prepares the run — financial, monthly
//   the OWNER approves it           — before anybody is paid
//
// draft → approved → paid, and no shortcut between them. The person who
// works out the figures is not the person who authorises them; that is not
// bureaucracy, it is the only control a small business has.
//
// WHAT THIS DELIBERATELY DOES NOT DO: compute a PF or ESI rate, file
// anything with anybody, or move money. Statutory rates change by
// notification, differ by state and differ entirely outside this country,
// and a wrong one computed confidently is worse than no figure at all. The
// app captures WHAT WAS WITHHELD and WHAT WAS PAID. The rate is the
// accountant's, and so is the filing.

import { z } from 'zod'
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { nextDocNo } from '@/server/doc-numbers'
import { assertAccount, AccountRefusal } from '@/server/accounts-queries'
import {
  getOutstandingAdvances,
  getPayrollRun,
  outstandingByStaff,
  recoveryDrift,
} from '@/server/payroll-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { addMonths } from '@/lib/advances'
import { recordAct } from '@/server/approvals-queries'
import {
  assertFulfillable,
  AdvanceRefusal,
  listFulfillableRequests,
  type FulfillableRequest,
} from '@/server/advances-queries'
import { IdentitySchema, writeIdentity } from '@/server/staff-identity'
import type {
  MarkPaidInput,
  PayrollResult,
  PreparePayrollInput,
  SaveAdvanceInput,
  SaveAdvanceResult,
  UpdateStaffIdentityInput,
} from '@/lib/types'
import type { Role } from '@/lib/roles'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONEY = /^\d{1,11}(\.\d{1,2})?$/

class PayrollError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof PayrollError) return { ok: false, error: e.message }
  if (e instanceof AccountRefusal) return { ok: false, error: e.message }
  // A REFUSAL NOBODY CAN READ IS NOT A REFUSAL. Without this the fulfilment
  // guard's sentences collapse into "Failed — nothing was written", and
  // "somebody already recorded that approval" becomes indistinguishable from
  // a server falling over. The same reason AccountRefusal is named above.
  if (e instanceof AdvanceRefusal) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('payroll action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

async function actor(allowed: Role[], what: string): Promise<string> {
  const user = await getSessionUser()
  if (!user) throw new PayrollError('Sign in again — the session has expired')
  if (!allowed.includes(user.role)) {
    const who = allowed.includes('owner') && allowed.length === 1 ? 'an owner' : 'the accountant or an owner'
    throw new PayrollError(`${what} needs ${who}`)
  }
  return user.username
}

/* ── prepare ───────────────────────────────────────────────────────────── */

const LineSchema = z.object({
  staffId: z.string().regex(UUID),
  daysInPeriod: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
  daysPaid: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
  baseSalary: z.string().regex(MONEY),
  earned: z.string().regex(MONEY),
  overtime: z.string().regex(MONEY),
  advanceRecovered: z.string().regex(MONEY),
  otherDeduction: z.string().regex(MONEY),
  withholding: z.string().regex(MONEY),
  note: z.string().trim().max(300),
})

const PrepareSchema = z.object({
  periodStart: z.string().regex(DATE_RE),
  periodEnd: z.string().regex(DATE_RE),
  note: z.string().trim().max(500),
  lines: z.array(LineSchema).min(1, 'A run with no lines is not a run'),
})

/**
 * FREEZE. Every figure the accountant has on screen is written as it
 * stands, and `payroll_lines` has no UPDATE grant on any amount — so from
 * this moment the run says what it says. A mistake is fixed by CANCELLING
 * the run and preparing another, which leaves both on the record.
 *
 * net_payable is computed HERE, once, from the frozen parts, rather than
 * being sent by the client: it is the number someone is actually paid, and
 * the one figure that must not be capable of disagreeing with its own
 * components.
 */
export async function preparePayrollRun(raw: PreparePayrollInput): Promise<PayrollResult> {
  try {
    const input = PrepareSchema.parse(raw)
    const by = await actor(['accountant', 'owner'], 'Preparing a payroll run')
    if (input.periodEnd < input.periodStart) throw new PayrollError('The period ends before it starts')

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    // The CHECK would refuse this at insert, but a constraint violation
    // reaches the user as a database error. Refuse it by name instead.
    for (const l of input.lines) {
      if (Number(l.daysPaid) > Number(l.daysInPeriod)) {
        throw new PayrollError(
          `More days paid than the period holds — that is the fault that paid 34 days in a 30-day month`,
        )
      }
    }

    const runId = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      const [clash] = await tx<{ period_start: string }[]>`
        select period_start::text as period_start from payroll_runs
        where restaurant_id = ${rid} and status <> 'cancelled'
          and period_start <= ${input.periodEnd}::date and period_end >= ${input.periodStart}::date
        limit 1`
      if (clash) {
        throw new PayrollError(
          `A run already covers that period (from ${clash.period_start}). Cancel it before preparing another.`,
        )
      }

      // MORE THAN IS OWED IS REFUSED BY NAME, and it is checked HERE rather
      // than on the form: a form is never the check, and this one is reachable
      // by anybody who can post to a server action.
      //
      // INSIDE THE LOCK, against what is owed NOW. The draft was computed when
      // the screen loaded; an advance reversed since would make a recovery
      // that looked right then too large now, and taking money off somebody's
      // pay that they do not owe is the one error here that cannot be argued
      // back afterwards.
      const owedNow = await outstandingByStaff(tx, rid)
      const over = input.lines
        .map((l) => ({ l, owed: owedNow.get(l.staffId) ?? 0 }))
        .filter((x) => Number(x.l.advanceRecovered) > x.owed + 0.005)
      if (over.length > 0) {
        const [{ l, owed }] = over
        const [who] = await tx<{ name: string }[]>`
          select name from staff where restaurant_id = ${rid} and id = ${l.staffId}`
        throw new PayrollError(
          `${who?.name ?? 'Somebody'} owes ${formatMoneyString(owed.toFixed(2))} and this run recovers ${formatMoneyString(l.advanceRecovered)} — a run cannot take back more than was lent.`,
        )
      }

      const docNo = await nextDocNo(tx, rid, 'RUN', input.periodEnd)
      const [run] = await tx<{ id: string }[]>`
        insert into payroll_runs (restaurant_id, period_start, period_end, doc_no, status, prepared_by, note)
        values (${rid}, ${input.periodStart}, ${input.periodEnd}, ${docNo}, 'draft', ${by},
                ${input.note === '' ? null : input.note})
        returning id`

      const rows = input.lines.map((l) => {
        const net =
          Number(l.earned) + Number(l.overtime) - Number(l.advanceRecovered) -
          Number(l.otherDeduction) - Number(l.withholding)
        return {
          restaurant_id: rid,
          run_id: run.id,
          staff_id: l.staffId,
          days_in_period: l.daysInPeriod,
          days_paid: l.daysPaid,
          base_salary: l.baseSalary,
          earned: l.earned,
          overtime: l.overtime,
          advance_recovered: l.advanceRecovered,
          other_deduction: l.otherDeduction,
          withholding: l.withholding,
          net_payable: net.toFixed(2),
          note: l.note === '' ? null : l.note,
        }
      })
      await tx`insert into payroll_lines ${tx(
        rows,
        'restaurant_id', 'run_id', 'staff_id', 'days_in_period', 'days_paid', 'base_salary', 'earned',
        'overtime', 'advance_recovered', 'other_deduction', 'withholding', 'net_payable', 'note',
      )}`
      return run.id
    })

    const run = await getPayrollRun(rid, runId)
    if (!run) throw new PayrollError('Could not read the run back after preparing')
    return { ok: true, run }
  } catch (e) {
    return fail(e)
  }
}

/* ── approve ───────────────────────────────────────────────────────────── */

/**
 * OWNER ONLY, and it is the whole reason the status column exists. The
 * accountant works out what everyone is owed; the owner is the one who says
 * it may be paid. Approving your own preparation would make the split
 * decorative, so the server refuses even an accountant who happens to hold
 * both jobs — if one person really does both, they sign in as the owner and
 * the record says an owner approved it.
 */
export async function approvePayrollRun(id: string): Promise<PayrollResult> {
  try {
    if (!UUID.test(id)) throw new PayrollError('Malformed run id')
    const by = await actor(['owner'], 'Approving a payroll run')
    const restaurant = await getRestaurant()

    // THE WORLD MOVES BETWEEN PREPARING AND APPROVING, and an advance taken
    // in that gap is missed by a run that was computed before it existed.
    //
    // IT REFUSES RATHER THAN ADJUSTS, and that is the GRANT speaking rather
    // than a preference: kb_app holds UPDATE on payroll_lines for exactly
    // account_id, note, paid_on and pay_mode. No amount is updatable by
    // anybody, ever — so a run whose recovery is wrong is cancelled and
    // prepared again, and both stay on the record. Same shape as the payment
    // drift guard, for the same reason.
    const [row] = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${restaurant.id}, 0))`
      const drift = await recoveryDrift(tx, restaurant.id, id)
      if (drift.length > 0) {
        const d = drift[0]
        throw new PayrollError(
          drift.length === 1
            ? `${d.name} owes ${formatMoneyString(d.owed)} now and this run recovers ${formatMoneyString(d.recovering)}. It was prepared before that changed — cancel it and prepare again.`
            : `${drift.length} people owe something different from what this run recovers — ${d.name} owes ${formatMoneyString(d.owed)} against ${formatMoneyString(d.recovering)}. Cancel it and prepare again.`,
        )
      }
      return tx<{ id: string }[]>`
        update payroll_runs
        set status = 'approved', approved_by = ${by}, approved_at = now()
        where id = ${id} and restaurant_id = ${restaurant.id} and status = 'draft'
        returning id`
    })
    if (!row) throw new PayrollError('Only a draft run can be approved — reload and check its status')

    const run = await getPayrollRun(restaurant.id, id)
    if (!run) throw new PayrollError('Could not read the run back')
    return { ok: true, run }
  } catch (e) {
    return fail(e)
  }
}

/** A draft that was wrong. Cancelling leaves it on the record — the run
 *  that was prepared and abandoned is itself a thing that happened. */
export async function cancelPayrollRun(id: string): Promise<PayrollResult> {
  try {
    if (!UUID.test(id)) throw new PayrollError('Malformed run id')
    await actor(['accountant', 'owner'], 'Cancelling a payroll run')
    const restaurant = await getRestaurant()

    const [row] = await tsql<{ id: string }[]>`
      update payroll_runs set status = 'cancelled'
      where id = ${id} and restaurant_id = ${restaurant.id} and status in ('draft', 'approved')
      returning id`
    if (!row) throw new PayrollError('A paid run cannot be cancelled — the money has gone')

    const run = await getPayrollRun(restaurant.id, id)
    if (!run) throw new PayrollError('Could not read the run back')
    return { ok: true, run }
  } catch (e) {
    return fail(e)
  }
}

/* ── mark paid ─────────────────────────────────────────────────────────── */

const MarkPaidSchema = z.object({
  runId: z.string().regex(UUID),
  paidOn: z.string().regex(DATE_RE),
  accountId: z.string().trim(),
  payMode: z.string().trim().max(40),
})

/**
 * Records that wages went out: the date, the account and the mode, onto
 * every line at once. Only after an owner has approved.
 *
 * THIS DOES NOT MOVE MONEY, and it does not pretend to. `money_movements`
 * does not read `payroll_lines`, so a paid run does not appear in the cash
 * or bank register — that is the schema's decision, not this function's,
 * and the payroll screen says so rather than letting an accountant
 * discover it while reconciling. Advances DO reach the register, because
 * `staff_advances` is in that view.
 */
export async function markPayrollPaid(raw: MarkPaidInput): Promise<PayrollResult> {
  try {
    const input = MarkPaidSchema.parse(raw)
    await actor(['accountant', 'owner'], 'Recording a payroll payment')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const accountId = await assertAccount(rid, input.accountId, 'the account the wages were paid from')

    await txn(async (tx) => {
      const [run] = await tx<{ id: string }[]>`
        update payroll_runs set status = 'paid'
        where id = ${input.runId} and restaurant_id = ${rid} and status = 'approved'
        returning id`
      if (!run) throw new PayrollError('Only an approved run can be marked paid — an owner signs it off first')
      await tx`
        update payroll_lines
        set paid_on = ${input.paidOn}::date, account_id = ${accountId},
            pay_mode = ${input.payMode === '' ? null : input.payMode}
        where run_id = ${input.runId} and restaurant_id = ${rid}`
    })

    const run = await getPayrollRun(rid, input.runId)
    if (!run) throw new PayrollError('Could not read the run back')
    return { ok: true, run }
  } catch (e) {
    return fail(e)
  }
}

/* ── advances ──────────────────────────────────────────────────────────── */

const AdvanceSchema = z.object({
  date: z.string().regex(DATE_RE),
  staffId: z.string().regex(UUID),
  amount: z.string().regex(MONEY),
  accountId: z.string().trim(),
  note: z.string().trim().max(300),
  /** SET MAKES IT A LOAN. There is no kind flag and there must not be one:
   *  the column comment says the category is derived from this, so a second
   *  field saying the same thing is one more place for the two to disagree. */
  instalment: z.string().trim(),
  /** COMPUTED AND SHOWN, not typed — but editable, because the owner may know
   *  a different last date than the arithmetic implies. A mismatch between
   *  this and amount/instalment is HIS to state and is not an error. */
  expectedEnd: z.string().trim(),
  /** Optional. An advance recorded with no request is legitimate: the owner
   *  lending from his own account needs no approval from himself. */
  approvedRequestId: z.string().trim(),
})

/** An advance is real money leaving a real account today, so it names one
 *  and takes an ADV number like every other payment. It comes back as
 *  `advance_recovered` on a later run, offered by the draft and editable
 *  until that run is prepared. */
/**
 * WHOSE APPROVED ADVANCE REQUESTS ARE STILL WAITING — for the picker.
 *
 * A READ, and still gated: every export from a 'use server' file is a public
 * endpoint, and this one would otherwise hand any signed-in reader the reasons
 * people asked for money and who approved them.
 */
export async function loadFulfillable(staffId: string): Promise<FulfillableRequest[]> {
  try {
    if (!UUID.test(staffId)) return []
    await actor(['accountant', 'owner'], 'Reading advance requests')
    const restaurant = await getRestaurant()
    return await listFulfillableRequests(restaurant.id, staffId)
  } catch {
    // A PICKER THAT CANNOT READ OFFERS NOTHING rather than blocking the form:
    // an advance with no request against it is legitimate, so a failed read
    // must not stop the money being recorded.
    return []
  }
}

export async function saveAdvance(raw: SaveAdvanceInput): Promise<SaveAdvanceResult> {
  try {
    const input = AdvanceSchema.parse(raw)
    const by = await actor(['accountant', 'owner'], 'Recording an advance')
    if (!(Number(input.amount) > 0)) throw new PayrollError('The amount must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const accountId = await assertAccount(rid, input.accountId, 'the account this advance was paid from')

    // A LOAN IS AN ADVANCE WITH AN INSTALMENT, and the arithmetic is worked
    // out here so nobody agrees to a number of months nobody counted.
    const amountPaise = decimalStringToPaise(input.amount)
    let instPaise: number | null = null
    let months: number | null = null
    if (input.instalment !== '') {
      const p = decimalStringToPaise(input.instalment)
      instPaise = p
      if (!(p > 0)) {
        throw new PayrollError('An instalment of nothing is not an instalment — leave it blank to recover the whole advance at the next payroll')
      }
      if (p > amountPaise) {
        throw new PayrollError(
          `The instalment (${formatMoneyString(input.instalment)}) is more than the advance (${formatMoneyString(input.amount)}). Leave it blank to take the whole thing back at once.`,
        )
      }
      months = Math.ceil(amountPaise / p)
    }
    // THE LAST INSTALMENT, not the month after it — the fencepost the ledger's
    // by-value gate already caught once.
    const expectedEnd =
      input.expectedEnd !== ''
        ? input.expectedEnd
        : months === null
          ? null
          : addMonths(input.date, months - 1)

    const fulfilled = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      // A REQUEST CANNOT BE FULFILLED TWICE, and it is checked HERE rather
      // than on the form: under the lock, against what is true now. Two
      // screens open on the same approved request would otherwise write two
      // advances and double somebody's debt, with both rows looking correct.
      // THE GUARD LIVES IN advances-queries, not here: it decides on the
      // strength of ids passed in, and every export from this file is a public
      // endpoint. It is also what lets the gate run the app's own rule.
      const reqAmount =
        input.approvedRequestId === ''
          ? null
          : await assertFulfillable(tx, rid, input.approvedRequestId, input.staffId)

      const docNo = await nextDocNo(tx, rid, 'ADV', input.date)
      await tx`
        insert into staff_advances (restaurant_id, adv_date, staff_id, amount, account_id, doc_no, note,
                                    entered_by, instalment, expected_end, approved_request_id)
        values (${rid}, ${input.date}, ${input.staffId}, ${input.amount}::numeric,
                ${accountId}, ${docNo}, ${input.note === '' ? null : input.note}, ${by},
                ${instPaise === null ? null : input.instalment}::numeric,
                ${expectedEnd}::date,
                ${input.approvedRequestId === '' ? null : input.approvedRequestId}::uuid)`

      // THE REQUEST AND THE ROW THAT SETTLES IT ARE ONE WRITE. A recorded
      // advance with an approval left standing is an owner asked twice; an
      // applied request with no advance is a debt nobody can see.
      if (input.approvedRequestId !== '') {
        await recordAct(tx, rid, {
          id: input.approvedRequestId,
          action: 'paid',
          from: ['approved'],
          status: 'applied',
          by,
          note: `recorded as ${docNo}`,
          decision: true,
          assignTo: null,
        })
      }
      return reqAmount
    })
    // What they now owe, read back from the same query the payroll draft
    // offers as recovery — never echoed from the amount just typed, because
    // this is rarely their first advance.
    const owed = (await getOutstandingAdvances(rid)).find((a) => a.staff_id === input.staffId) ?? null
    return {
      ok: true,
      outstanding: owed?.outstanding ?? input.amount,
      staffName: owed?.staff_name ?? null,
      instalment: instPaise === null ? null : input.instalment,
      months,
      expectedEnd,
      fulfilled: fulfilled !== null,
    }
  } catch (e) {
    return fail(e)
  }
}

/* ── the identifier block ──────────────────────────────────────────────── */

/**
 * OWNER AND ACCOUNTANT ONLY — never the manager. The manager marks
 * attendance and has no reason to hold anybody's bank account number or
 * date of birth, and "no reason to hold it" is the whole of data
 * protection in one sentence. The matrix keeps them out of /accounts, and
 * this re-checks the role anyway, because a server action is a public
 * endpoint and the route gate is not the check.
 *
 * These columns exist now because real auth exists. Phase 5 refused to
 * collect them for exactly that reason — the form must not ask for what
 * the app cannot yet protect.
 */
export async function updateStaffIdentity(
  staffId: string,
  raw: UpdateStaffIdentityInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!UUID.test(staffId)) throw new PayrollError('Malformed staff id')
    const input = IdentitySchema.parse(raw)
    await actor(['accountant', 'owner'], 'Editing a staff identifier')
    const restaurant = await getRestaurant()

    // one SET list, shared with the owner's half of the staff form
    const ok = await txn((tx) => writeIdentity(tx, staffId, restaurant.id, input))
    if (!ok) throw new PayrollError('That staff member no longer exists')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
