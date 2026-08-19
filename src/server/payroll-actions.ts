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
import { getOutstandingAdvances, getPayrollRun } from '@/server/payroll-queries'
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

    const [row] = await tsql<{ id: string }[]>`
      update payroll_runs
      set status = 'approved', approved_by = ${by}, approved_at = now()
      where id = ${id} and restaurant_id = ${restaurant.id} and status = 'draft'
      returning id`
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
})

/** An advance is real money leaving a real account today, so it names one
 *  and takes an ADV number like every other payment. It comes back as
 *  `advance_recovered` on a later run, offered by the draft and editable
 *  until that run is prepared. */
export async function saveAdvance(raw: SaveAdvanceInput): Promise<SaveAdvanceResult> {
  try {
    const input = AdvanceSchema.parse(raw)
    const by = await actor(['accountant', 'owner'], 'Recording an advance')
    if (!(Number(input.amount) > 0)) throw new PayrollError('The amount must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const accountId = await assertAccount(rid, input.accountId, 'the account this advance was paid from')

    await txn(async (tx) => {
      const docNo = await nextDocNo(tx, rid, 'ADV', input.date)
      await tx`
        insert into staff_advances (restaurant_id, adv_date, staff_id, amount, account_id, doc_no, note, entered_by)
        values (${rid}, ${input.date}, ${input.staffId}, ${input.amount}::numeric,
                ${accountId}, ${docNo}, ${input.note === '' ? null : input.note}, ${by})`
    })
    // What they now owe, read back from the same query the payroll draft
    // offers as recovery — never echoed from the amount just typed, because
    // this is rarely their first advance.
    const owed = (await getOutstandingAdvances(rid)).find((a) => a.staff_id === input.staffId) ?? null
    return { ok: true, outstanding: owed?.outstanding ?? input.amount, staffName: owed?.staff_name ?? null }
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
