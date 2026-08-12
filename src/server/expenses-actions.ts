'use server'

// Write side of expenses — non-drawer money only, INSERT-only, corrections
// are negative twins. THE RULE THE FORM REPEATS: paid_via never offers
// till cash. Money leaving the drawer is a Cash Voucher and lands on the
// day's ladder; an expense here paid "Cash" would vanish from the drawer
// math, so the server refuses it by name.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { AccountRefusal, assertAccount } from '@/server/accounts-queries'
import { enteredBy } from '@/server/current-user'
import { nextDocNo } from '@/server/doc-numbers'
import { getList } from '@/server/settings'
import { noteListSuggestion } from '@/server/settings-actions'
import { getCasualLabour, getContractBill, getExpense } from '@/server/expenses-queries'
import { parseMoney } from '@/lib/money'
import type {
  SaveCasualLabourInput,
  SaveCasualLabourResult,
  SaveContractBillInput,
  SaveContractBillResult,
  SaveExpenseInput,
  SaveExpenseResult,
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

const ExpenseSchema = z.object({
  accountId: z.string().trim(),
  date: z.string().regex(DATE_RE),
  category: z.string().trim().min(1, 'Pick the category').max(60),
  payee: z.string().trim().max(120),
  amount: moneyStr,
  paidVia: z.string().trim().min(1, 'Pick how it was paid').max(30),
  note: z.string().trim().max(300),
})

export async function saveExpense(raw: SaveExpenseInput): Promise<SaveExpenseResult> {
  try {
    const input = ExpenseSchema.parse(raw)
    const d = new Date(`${input.date}T00:00:00Z`)
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.date) {
      throw new ExpenseError('Expense date is not a real calendar date')
    }
    const year = Number(input.date.slice(0, 4))
    if (year < 2000 || year > 2100) throw new ExpenseError('Expense date is out of range')
    const amount = parseMoney(input.amount)
    if (amount === null || amount <= 0) throw new ExpenseError('Amount must be more than zero')
    if (input.paidVia.toLowerCase() === 'cash') {
      throw new ExpenseError('Paid from the drawer? That is a Cash Voucher — record it on the Cash page, where it joins the day’s ladder')
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    // Accept, then record. The expense_category list was EMPTY in
    // production, which meant this form refused every entry that reached
    // it — the rule was protecting the vocabulary by preventing the work.
    const by = await enteredBy()
    const categories = await getList(rid, 'expense_category')
    if (!categories.some((c) => c.toLowerCase() === input.category.toLowerCase())) {
      await noteListSuggestion(rid, 'expense_category', input.category, by)
    }
    const modes = await getList(rid, 'payment_mode')
    if (!modes.some((m) => m.toLowerCase() === input.paidVia.toLowerCase())) {
      await noteListSuggestion(rid, 'payment_mode', input.paidVia, by)
    }

    const accountId = await assertAccount(rid, input.accountId, 'the account this expense was paid from')
    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      // The expense's own date, not today: a receipt entered a week late
      // still belongs to the financial year the money left.
      const docNo = await nextDocNo(tx, rid, 'EXP', input.date)
      const [row] = await tx<{ id: string }[]>`
        insert into expenses (restaurant_id, expense_date, category, payee, amount, paid_via, note, entered_by, account_id, doc_no)
        values (${rid}, ${input.date}, ${input.category},
                ${input.payee === '' ? null : input.payee.replace(/\s+/g, ' ')},
                ${input.amount}, ${input.paidVia},
                ${input.note === '' ? null : input.note}, ${by}, ${accountId}, ${docNo})
        returning id`
      return { id: row.id }
    })

    const expense = await getExpense(rid, saved.id)
    if (!expense) throw new ExpenseError('Could not verify the save — expense missing after commit')
    return { ok: true, expense }
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

    const saved = await sql.begin(async (tx) => {
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
    const row = await sql.begin(async (tx) => {
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
    const [orig] = await sql<{ reverses_id: string | null; bill_date: string }[]>`
      select reverses_id, bill_date::text as bill_date
      from contract_bills where id = ${id} and restaurant_id = ${rid}`
    if (!orig) throw new ExpenseError('Bill not found')
    if (orig.reverses_id !== null) throw new ExpenseError('This is a reversal — reversals cannot be voided')
    const already = await sql<{ id: string }[]>`select id from contract_bills where reverses_id = ${id} limit 1`
    if (already[0]) throw new ExpenseError('This bill is already voided')
    await sql.begin(async (tx) => {
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

const CasualSchema = z.object({
  accountId: z.string().trim(),
  date: z.string().regex(DATE_RE),
  sectionId: z.union([z.literal(''), z.string().regex(UUID)]),
  persons: z.string().regex(/^\d{1,4}$/, 'How many people?'),
  description: z.string().trim().max(200),
  amount: moneyStr,
  paidVia: z.string().trim().min(1, 'Pick how it was paid').max(30),
  note: z.string().trim().max(300),
})

export async function saveCasualLabour(raw: SaveCasualLabourInput): Promise<SaveCasualLabourResult> {
  try {
    const input = CasualSchema.parse(raw)
    const amount = parseMoney(input.amount)
    if (amount === null || amount <= 0) throw new ExpenseError('Amount must be more than zero')
    if (Number(input.persons) <= 0) throw new ExpenseError('At least one person worked')
    if (input.paidVia.toLowerCase() === 'cash') {
      throw new ExpenseError(
        'Paid from the drawer? That is a Cash Voucher — record it on the Cash page, where the day’s ladder can see it',
      )
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()
    const modes = await getList(rid, 'payment_mode')
    if (!modes.some((m) => m.toLowerCase() === input.paidVia.toLowerCase())) {
      await noteListSuggestion(rid, 'payment_mode', input.paidVia, by)
    }

    const accountId = await assertAccount(rid, input.accountId, 'the account these wages were paid from')

    // Same reason as the contract bill: the number is allocated on the
    // transaction so a failed insert does not burn one.
    const row = await sql.begin(async (tx) => {
      // The day the work was done, not the day it was typed up.
      const docNo = await nextDocNo(tx, rid, 'CAS', input.date)
      const [r] = await tx<{ id: string }[]>`
        insert into casual_labour (restaurant_id, work_date, section_id, persons, description,
                                   amount, paid_via, note, entered_by, account_id, doc_no)
        values (${rid}, ${input.date}, ${input.sectionId === '' ? null : input.sectionId},
                ${Number(input.persons)}, ${trimmedOrNull(input.description)},
                ${input.amount}, ${input.paidVia}, ${trimmedOrNull(input.note)}, ${by}, ${accountId}, ${docNo})
        returning id`
      return r
    })

    const entry = await getCasualLabour(rid, row.id)
    if (!entry) throw new ExpenseError('Could not verify the save — entry missing after commit')
    return { ok: true, entry }
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
    const [orig] = await sql<{ reverses_id: string | null; work_date: string }[]>`
      select reverses_id, work_date::text as work_date
      from casual_labour where id = ${id} and restaurant_id = ${rid}`
    if (!orig) throw new ExpenseError('Entry not found')
    if (orig.reverses_id !== null) throw new ExpenseError('This is a reversal — reversals cannot be voided')
    const already = await sql<{ id: string }[]>`select id from casual_labour where reverses_id = ${id} limit 1`
    if (already[0]) throw new ExpenseError('This entry is already voided')
    await sql.begin(async (tx) => {
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
