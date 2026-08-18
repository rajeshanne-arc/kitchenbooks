'use server'

// Write side of expenses — non-drawer money only, INSERT-only, corrections
// are negative twins. THE RULE THE FORM REPEATS: paid_via never offers
// till cash. Money leaving the drawer is a Cash Voucher and lands on the
// day's ladder; an expense here paid "Cash" would vanish from the drawer
// math, so the server refuses it by name.

import { z } from 'zod'
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { AccountRefusal, assertAccount } from '@/server/accounts-queries'
import { enteredBy } from '@/server/current-user'
import { nextDocNo } from '@/server/doc-numbers'
import { getList } from '@/server/settings'
import { noteListSuggestion } from '@/server/settings-actions'
import { getCasualLabour, getContractBill, getExpense } from '@/server/expenses-queries'
import { parseMoney } from '@/lib/money'
import type {
  CasualLabourRow,
  SaveCasualLaboursInput,
  SaveCasualLaboursResult,
  SaveContractBillInput,
  SaveContractBillResult,
  ExpenseRow,
  SaveExpensesInput,
  SaveExpensesResult,
  VoidExpenseResult,
} from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const moneyStr = z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'plain amount, up to 2 decimals')

class ExpenseError extends Error {}

const trimmedOrNull = (v: string): string | null => (v.trim() === '' ? null : v.trim())

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ExpenseError) return { ok: false, error: e.message }
  // A refusal to guess is not a failure — it names the missing answer, so
  // it reaches the user in its own words rather than wrapped in an apology.
  if (e instanceof AccountRefusal) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('expense action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}


const ExpenseLineSchema = z.object({
  accountId: z.string().trim(),
  category: z.string().trim().min(1, 'A category is required').max(60),
  payee: z.string().trim().max(120),
  amount: z.string().trim(),
  paidVia: z.string().trim().min(1, 'How was it paid?').max(60),
  note: z.string().trim().max(300),
})

const ExpensesSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(ExpenseLineSchema).min(1, 'Nothing to record').max(40),
})

/**
 * N expenses, N DOCUMENT NUMBERS. A batch is a convenience of ENTRY, not a
 * document — each receipt is separately voidable and separately cited later.
 * Contrast `saveShorts`, where the header is a BILL that already exists and is
 * already numbered; here the header is a date.
 *
 * Errors name the PAYEE, because that is what is written on the receipt in
 * the hand of whoever is typing.
 */
export async function saveExpenses(raw: SaveExpensesInput): Promise<SaveExpensesResult> {
  try {
    const input = ExpensesSchema.parse(raw)
    const d = new Date(`${input.date}T00:00:00Z`)
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.date) {
      throw new ExpenseError('Expense date is not a real calendar date')
    }
    const year = Number(input.date.slice(0, 4))
    if (year < 2000 || year > 2100) throw new ExpenseError('Expense date is out of range')

    for (const l of input.lines) {
      const who = l.payee.trim() === '' ? `“${l.category}”` : l.payee.trim()
      const amount = parseMoney(l.amount)
      if (amount === null || amount <= 0) throw new ExpenseError(`${who}: amount must be more than zero`)
      if (l.paidVia.toLowerCase() === 'cash') {
        throw new ExpenseError(
          `${who}: paid from the drawer? That is a Cash Voucher — record it on the Cash page, where it joins the day’s ladder`,
        )
      }
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    // Accept, then record. The expense_category list was EMPTY in production,
    // which meant this form refused every entry that reached it — the rule was
    // protecting the vocabulary by preventing the work.
    //
    // OUTSIDE the transaction, and once per DISTINCT value: noteListSuggestion
    // opens its own statement, and a tsql inside a txn() callback holds one
    // connection while waiting for a second.
    const categories = await getList(rid, 'expense_category')
    const modes = await getList(rid, 'payment_mode')
    for (const c of new Set(input.lines.map((l) => l.category))) {
      if (!categories.some((k) => k.toLowerCase() === c.toLowerCase())) {
        await noteListSuggestion(rid, 'expense_category', c, by)
      }
    }
    for (const m of new Set(input.lines.map((l) => l.paidVia))) {
      if (!modes.some((k) => k.toLowerCase() === m.toLowerCase())) {
        await noteListSuggestion(rid, 'payment_mode', m, by)
      }
    }

    // Per line: two receipts in one sitting can be paid from two accounts.
    const accountIds: string[] = []
    for (const l of input.lines) {
      const who = l.payee.trim() === '' ? `“${l.category}”` : l.payee.trim()
      accountIds.push(await assertAccount(rid, l.accountId, `the account ${who} was paid from`))
    }

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const ids: string[] = []
      for (const [i, l] of input.lines.entries()) {
        // The expense's own date, not today: a receipt entered a week late
        // still belongs to the financial year the money left. One draw per
        // line, on the tx, so a rollback consumes no number.
        const docNo = await nextDocNo(tx, rid, 'EXP', input.date)
        const [row] = await tx<{ id: string }[]>`
          insert into expenses (restaurant_id, expense_date, category, payee, amount, paid_via, note, entered_by, account_id, doc_no)
          values (${rid}, ${input.date}, ${l.category},
                  ${l.payee === '' ? null : l.payee.replace(/\s+/g, ' ')},
                  ${l.amount}, ${l.paidVia},
                  ${l.note === '' ? null : l.note}, ${by}, ${accountIds[i]}, ${docNo})
          returning id`
        ids.push(row.id)
      }
      return ids
    })

    const expenses: ExpenseRow[] = []
    for (const id of saved) {
      const e = await getExpense(rid, id)
      if (!e) throw new ExpenseError('Could not verify the save — an expense is missing after commit')
      expenses.push(e)
    }
    const total = expenses.reduce((n, e) => n + Number(e.amount), 0).toFixed(2)
    return { ok: true, expenses, total }
  } catch (e) {
    return fail(e)
  }
}

export async function voidExpense(id: string): Promise<VoidExpenseResult> {
  try {
    if (!UUID.test(id)) throw new ExpenseError('Malformed expense id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [orig] = await tx<{ id: string; reverses_id: string | null; expense_date: string }[]>`
        select id, reverses_id, expense_date::text as expense_date
        from expenses where id = ${id} and restaurant_id = ${rid}`
      if (!orig) throw new ExpenseError('Expense not found')
      if (orig.reverses_id !== null) throw new ExpenseError('This is a reversal — reversals cannot be voided')
      const already = await tx<{ id: string }[]>`select id from expenses where reverses_id = ${id} limit 1`
      if (already[0]) throw new ExpenseError('This expense is already voided')
      // The reversal takes its OWN number and the voided expense keeps
      // its own — dated with the original so both land in one FY series.
      const revDocNo = await nextDocNo(tx, rid, 'EXP', orig.expense_date)
      // The reversal copies the original's ACCOUNT EXACTLY, never a fresh
      // one: money_movements negates the reversal too, so the two rows must
      // land on the same account to net it back to nothing. A void that
      // named a different account — or none — would leave that account
      // permanently short by the amount, and nothing on screen would say so.
      const [rev] = await tx<{ id: string }[]>`
        insert into expenses (restaurant_id, expense_date, category, payee, amount, paid_via, note, reverses_id, entered_by, doc_no, account_id)
        select restaurant_id, expense_date, category, payee, -amount, paid_via, 'void', id, ${by}, ${revDocNo}, account_id
        from expenses where id = ${id}
        returning id`
      const [check] = await tx<{ zeroed: boolean }[]>`
        select ((select amount from expenses where id = ${id})
              + (select amount from expenses where id = ${rev.id}) = 0) as zeroed`
      if (!check?.zeroed) throw new ExpenseError('Verification failed: amounts do not cancel to zero')
      return { revId: rev.id }
    })

    const [original, reversal] = await Promise.all([getExpense(rid, id), getExpense(rid, saved.revId)])
    if (!original || !reversal || !original.is_voided) {
      throw new ExpenseError('Verification failed: could not read the voided pair back')
    }
    return { ok: true, original, reversal }
  } catch (e) {
    return fail(e)
  }
}

/* ── contract bills and casual labour ──────────────────────────────────────
 *
 * Both feed the P&L's labour line: pnl_monthly reads contract_vendors from
 * contract_bills and casual_labour from casual_labour. Until now both were
 * empty, so total_labour counted only salaried staff and understated what
 * labour actually costs.
 *
 * THE DRAWER RULE APPLIES HERE TOO, and for a checkable reason:
 * day_close_ladder reads cash_vouchers and does NOT read either of these
 * tables. Money paid out of the till and recorded here alone would leave
 * the drawer short at close with nothing to explain it. So till cash is
 * refused by name, exactly as it is on an expense.
 */

const ContractSchema = z.object({
  accountId: z.string().trim(),
  date: z.string().regex(DATE_RE),
  vendorName: z.string().trim().min(1, 'Who sent the bill?').max(120),
  service: z.string().trim().max(80),
  headcount: z.union([z.literal(''), z.string().regex(/^\d{1,4}$/)]),
  periodStart: z.union([z.literal(''), z.string().regex(DATE_RE)]),
  periodEnd: z.union([z.literal(''), z.string().regex(DATE_RE)]),
  amount: moneyStr,
  paidVia: z.string().trim().min(1, 'Pick how it was paid').max(30),
  note: z.string().trim().max(300),
})

export async function saveContractBill(raw: SaveContractBillInput): Promise<SaveContractBillResult> {
  try {
    const input = ContractSchema.parse(raw)
    const amount = parseMoney(input.amount)
    if (amount === null || amount <= 0) throw new ExpenseError('Amount must be more than zero')
    if (input.paidVia.toLowerCase() === 'cash') {
      throw new ExpenseError(
        'Paid from the drawer? That is a Cash Voucher — record it on the Cash page, where the day’s ladder can see it',
      )
    }
    if (input.periodStart !== '' && input.periodEnd !== '' && input.periodStart > input.periodEnd) {
      throw new ExpenseError('The period ends before it starts')
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()
    const modes = await getList(rid, 'payment_mode')
    if (!modes.some((m) => m.toLowerCase() === input.paidVia.toLowerCase())) {
      await noteListSuggestion(rid, 'payment_mode', input.paidVia, by)
    }

    const accountId = await assertAccount(rid, input.accountId, 'the account this bill was paid from')

    // The number is allocated on the transaction, so a failed insert takes
    // it back with it and the CON series stays gapless.
    const row = await txn(async (tx) => {
      // The bill's own date — a March bill entered in April is March's.
      const docNo = await nextDocNo(tx, rid, 'CON', input.date)
      const [r] = await tx<{ id: string }[]>`
        insert into contract_bills (restaurant_id, bill_date, vendor_name, service, headcount,
                                    period_start, period_end, amount, paid_via, note, entered_by, account_id, doc_no)
        values (${rid}, ${input.date}, ${input.vendorName}, ${trimmedOrNull(input.service)},
                ${input.headcount === '' ? null : Number(input.headcount)},
                ${input.periodStart === '' ? null : input.periodStart},
                ${input.periodEnd === '' ? null : input.periodEnd},
                ${input.amount}, ${input.paidVia}, ${trimmedOrNull(input.note)}, ${by}, ${accountId}, ${docNo})
        returning id`
      return r
    })

    const bill = await getContractBill(rid, row.id)
    if (!bill) throw new ExpenseError('Could not verify the save — bill missing after commit')
    return { ok: true, bill }
  } catch (e) {
    return fail(e)
  }
}

export async function voidContractBill(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!UUID.test(id)) throw new ExpenseError('Malformed bill id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()
    const [orig] = await tsql<{ reverses_id: string | null; bill_date: string }[]>`
      select reverses_id, bill_date::text as bill_date
      from contract_bills where id = ${id} and restaurant_id = ${rid}`
    if (!orig) throw new ExpenseError('Bill not found')
    if (orig.reverses_id !== null) throw new ExpenseError('This is a reversal — reversals cannot be voided')
    const already = await tsql<{ id: string }[]>`select id from contract_bills where reverses_id = ${id} limit 1`
    if (already[0]) throw new ExpenseError('This bill is already voided')
    await txn(async (tx) => {
      // Its own number, dated with the bill it reverses; the voided bill
      // keeps the number it was always known by.
      const revDocNo = await nextDocNo(tx, rid, 'CON', orig.bill_date)
      // account_id copied exactly, same reason as voidExpense above.
      await tx`
        insert into contract_bills (restaurant_id, bill_date, vendor_name, service, headcount,
                                    period_start, period_end, amount, paid_via, note, reverses_id, entered_by, doc_no, account_id)
        select restaurant_id, bill_date, vendor_name, service, headcount,
               period_start, period_end, -amount, paid_via, 'void', id, ${by}, ${revDocNo}, account_id
        from contract_bills where id = ${id}`
    })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}


const CasualLineSchema = z.object({
  accountId: z.string().trim(),
  sectionId: z.string().trim(),
  persons: z.string().trim(),
  description: z.string().trim().max(200),
  amount: z.string().trim(),
  paidVia: z.string().trim().min(1, 'How was it paid?').max(60),
  note: z.string().trim().max(300),
})

const CasualsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(CasualLineSchema).min(1, 'Nothing to record').max(40),
})

/**
 * The DEPARTMENT is per line, argued: a day's hands routinely split across
 * departments — one unloading for the store, one washing up in the kitchen —
 * and blank still means the whole place, which is a real answer for a day's
 * general labour rather than a missing one.
 *
 * N payments, N CAS numbers. Till cash is still refused by name, and still
 * points at the voucher question that does the same job in one entry.
 */
export async function saveCasualLabours(raw: SaveCasualLaboursInput): Promise<SaveCasualLaboursResult> {
  try {
    const input = CasualsSchema.parse(raw)

    for (const [i, l] of input.lines.entries()) {
      const what = l.description.trim() !== '' ? l.description.trim() : `line ${i + 1}`
      const amount = parseMoney(l.amount)
      if (amount === null || amount <= 0) throw new ExpenseError(`${what}: amount must be more than zero`)
      if (Number(l.persons) <= 0) throw new ExpenseError(`${what}: at least one person worked`)
      if (l.paidVia.toLowerCase() === 'cash') {
        throw new ExpenseError(
          `${what}: paid from the drawer? That is a Cash Voucher — record it on the Cash page, where the day’s ladder can see it`,
        )
      }
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const modes = await getList(rid, 'payment_mode')
    for (const m of new Set(input.lines.map((l) => l.paidVia))) {
      if (!modes.some((k) => k.toLowerCase() === m.toLowerCase())) {
        await noteListSuggestion(rid, 'payment_mode', m, by)
      }
    }

    const accountIds: string[] = []
    for (const l of input.lines) {
      accountIds.push(await assertAccount(rid, l.accountId, 'the account these wages were paid from'))
    }

    const saved = await txn(async (tx) => {
      const ids: string[] = []
      for (const [i, l] of input.lines.entries()) {
        // The day the work was done, not the day it was typed up. Allocated
        // on the transaction so a failed insert does not burn a number.
        const docNo = await nextDocNo(tx, rid, 'CAS', input.date)
        const [r] = await tx<{ id: string }[]>`
          insert into casual_labour (restaurant_id, work_date, section_id, persons, description,
                                     amount, paid_via, note, entered_by, account_id, doc_no)
          values (${rid}, ${input.date}, ${l.sectionId === '' ? null : l.sectionId},
                  ${Number(l.persons)}, ${trimmedOrNull(l.description)},
                  ${l.amount}, ${l.paidVia}, ${trimmedOrNull(l.note)}, ${by}, ${accountIds[i]}, ${docNo})
          returning id`
        ids.push(r.id)
      }
      return ids
    })

    const rows: CasualLabourRow[] = []
    for (const id of saved) {
      const r = await getCasualLabour(rid, id)
      if (!r) throw new ExpenseError('Could not verify the save — an entry is missing after commit')
      rows.push(r)
    }
    const total = rows.reduce((n, r) => n + Number(r.amount), 0).toFixed(2)
    return { ok: true, rows, total }
  } catch (e) {
    return fail(e)
  }
}

export async function voidCasualLabour(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!UUID.test(id)) throw new ExpenseError('Malformed entry id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()
    const [orig] = await tsql<{ reverses_id: string | null; work_date: string }[]>`
      select reverses_id, work_date::text as work_date
      from casual_labour where id = ${id} and restaurant_id = ${rid}`
    if (!orig) throw new ExpenseError('Entry not found')
    if (orig.reverses_id !== null) throw new ExpenseError('This is a reversal — reversals cannot be voided')
    const already = await tsql<{ id: string }[]>`select id from casual_labour where reverses_id = ${id} limit 1`
    if (already[0]) throw new ExpenseError('This entry is already voided')
    await txn(async (tx) => {
      // Its own number, dated with the day worked, so the correction sits
      // in the same year's series as the entry it cancels.
      const revDocNo = await nextDocNo(tx, rid, 'CAS', orig.work_date)
      // account_id copied exactly, same reason as voidExpense above.
      await tx`
        insert into casual_labour (restaurant_id, work_date, section_id, persons, description,
                                   amount, paid_via, note, reverses_id, entered_by, doc_no, account_id)
        select restaurant_id, work_date, section_id, persons, description,
               -amount, paid_via, 'void', id, ${by}, ${revDocNo}, account_id
        from casual_labour where id = ${id}`
    })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
