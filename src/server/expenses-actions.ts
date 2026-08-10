'use server'

// Write side of expenses — non-drawer money only, INSERT-only, corrections
// are negative twins. THE RULE THE FORM REPEATS: paid_via never offers
// till cash. Money leaving the drawer is a Cash Voucher and lands on the
// day's ladder; an expense here paid "Cash" would vanish from the drawer
// math, so the server refuses it by name.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { enteredBy } from '@/server/current-user'
import { getList } from '@/server/settings'
import { getExpense } from '@/server/expenses-queries'
import { parseMoney } from '@/lib/money'
import type { SaveExpenseInput, SaveExpenseResult, VoidExpenseResult } from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const moneyStr = z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'plain amount, up to 2 decimals')

class ExpenseError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ExpenseError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('expense action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

const ExpenseSchema = z.object({
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
    const categories = await getList(rid, 'expense_category')
    if (!categories.includes(input.category)) {
      throw new ExpenseError(`Category must come from the list — add “${input.category}” in Settings → Lists first`)
    }
    const modes = await getList(rid, 'payment_mode')
    if (!modes.includes(input.paidVia)) {
      throw new ExpenseError(`Payment mode must come from the list — add “${input.paidVia}” in Settings → Lists first`)
    }
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [row] = await tx<{ id: string }[]>`
        insert into expenses (restaurant_id, expense_date, category, payee, amount, paid_via, note, entered_by)
        values (${rid}, ${input.date}, ${input.category},
                ${input.payee === '' ? null : input.payee.replace(/\s+/g, ' ')},
                ${input.amount}, ${input.paidVia},
                ${input.note === '' ? null : input.note}, ${by})
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
      const [orig] = await tx<{ id: string; reverses_id: string | null }[]>`
        select id, reverses_id from expenses where id = ${id} and restaurant_id = ${rid}`
      if (!orig) throw new ExpenseError('Expense not found')
      if (orig.reverses_id !== null) throw new ExpenseError('This is a reversal — reversals cannot be voided')
      const already = await tx<{ id: string }[]>`select id from expenses where reverses_id = ${id} limit 1`
      if (already[0]) throw new ExpenseError('This expense is already voided')
      const [rev] = await tx<{ id: string }[]>`
        insert into expenses (restaurant_id, expense_date, category, payee, amount, paid_via, note, reverses_id, entered_by)
        select restaurant_id, expense_date, category, payee, -amount, paid_via, 'void', id, ${by}
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
