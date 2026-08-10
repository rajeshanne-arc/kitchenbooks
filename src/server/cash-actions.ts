'use server'

// Write side of cash — all INSERT-only. A day close stores its own opening
// (photographed at save, resolved server-side by the chain law — the cashier
// never types it). Re-filing a date inserts a new row that wins in
// day_close_current; the old filing stays visible as a correction. The HARD
// STOP: date D refuses to save while D-1 has no close.
//
// PAID BY on vouchers: 'owner' means the money never touched the drawer —
// the ladder view already filters those out; code must never re-add them.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import {
  getClosePrefill,
  getLadderDay,
  getOtherIncome,
  getVoucher,
} from '@/server/cash-queries'
import { todayIST } from '@/server/store-queries'
import { parseMoney, parseQty } from '@/lib/money'
import type {
  CloseDayInput,
  CloseDayResult,
  SaveOtherIncomeInput,
  SaveOtherIncomeResult,
  SaveVoucherInput,
  SaveVoucherResult,
  SetOpeningResult,
} from '@/lib/types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const moneyStr = z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'plain amount, up to 2 decimals')

class CashError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof CashError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('cash action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

function assertRealDate(s: string, label: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new CashError(`${label} is not a real calendar date`)
  }
  const year = Number(s.slice(0, 4))
  if (year < 2000 || year > 2100) throw new CashError(`${label} is out of range`)
}

/** Collapse inner whitespace so “Asheel  Sir” and “Asheel Sir” net together. */
const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ')

// ------------------------------------------------------------ other income

const IncomeSchema = z.object({
  date: z.string().regex(DATE_RE),
  item: z.string().trim().min(1, 'What was sold?').max(120),
  qty: z.string().trim().max(12),
  unit: z.string().trim().max(20),
  amount: moneyStr,
  buyer: z.string().trim().max(120),
  receivedBy: z.string().trim().max(120),
})

export async function saveOtherIncome(raw: SaveOtherIncomeInput): Promise<SaveOtherIncomeResult> {
  try {
    const input = IncomeSchema.parse(raw)
    assertRealDate(input.date, 'Income date')
    const amount = parseMoney(input.amount)
    if (amount === null || amount <= 0) throw new CashError('Amount must be more than zero')
    if (input.qty !== '') {
      const q = parseQty(input.qty)
      if (q === null || q <= 0) throw new CashError('Quantity must be a plain number more than zero')
      if (input.unit === '') {
        throw new CashError('A quantity needs its unit — oil is sold in litres, and the FSSAI expects the reconciliation')
      }
    }
    if (input.unit !== '' && input.qty === '') throw new CashError('A unit needs its quantity')

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      if (input.unit !== '') {
        const unit = await tx<{ code: string }[]>`select code from units where code = ${input.unit}`
        if (!unit[0]) throw new CashError('Unknown unit')
      }
      const [row] = await tx<{ id: string }[]>`
        insert into other_income (restaurant_id, income_date, item, qty, unit, amount, buyer, received_by)
        values (${rid}, ${input.date}, ${input.item}, ${input.qty === '' ? null : input.qty},
                ${input.unit === '' ? null : input.unit}, ${input.amount},
                ${input.buyer === '' ? null : cleanName(input.buyer)},
                ${input.receivedBy === '' ? null : cleanName(input.receivedBy)})
        returning id`
      return { id: row.id }
    })

    const income = await getOtherIncome(rid, saved.id)
    if (!income) throw new CashError('Could not verify the save — income row missing after commit')
    return { ok: true, income }
  } catch (e) {
    return fail(e)
  }
}

// ---------------------------------------------------------------- voucher

const VoucherSchema = z.object({
  date: z.string().regex(DATE_RE),
  amount: moneyStr,
  paidTo: z.string().trim().min(1, 'Who was paid?').max(120),
  paidBy: z.enum(['cashier', 'owner']),
  ownerName: z.string().trim().max(120),
  category: z.string().trim().max(60),
  note: z.string().trim().max(300),
})

export async function saveVoucher(raw: SaveVoucherInput): Promise<SaveVoucherResult> {
  try {
    const input = VoucherSchema.parse(raw)
    assertRealDate(input.date, 'Voucher date')
    const amount = parseMoney(input.amount)
    if (amount === null || amount <= 0) throw new CashError('Amount must be more than zero')

    const category = (input.category === '' ? 'general' : input.category).toLowerCase().replace(/\s+/g, '_')
    if (input.paidBy === 'owner' && input.ownerName === '') {
      throw new CashError('Owner-funded — pick which owner paid, so the debt lands in their ledger')
    }
    if (input.paidBy === 'owner' && category === 'owner_reimbursement') {
      throw new CashError('A reimbursement is paid by the cashier from the drawer — not by an owner')
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [row] = await tx<{ id: string }[]>`
        insert into cash_vouchers (restaurant_id, voucher_date, amount, paid_to, paid_by, owner_name, category, note)
        values (${rid}, ${input.date}, ${input.amount}, ${cleanName(input.paidTo)}, ${input.paidBy},
                ${input.paidBy === 'owner' ? cleanName(input.ownerName) : null}, ${category},
                ${input.note === '' ? null : input.note})
        returning id`
      return { id: row.id }
    })

    const voucher = await getVoucher(rid, saved.id)
    if (!voucher) throw new CashError('Could not verify the save — voucher missing after commit')
    return { ok: true, voucher }
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------------------- set opening

export async function setFirstOpening(raw: { amount: string }): Promise<SetOpeningResult> {
  try {
    const amount = moneyStr.parse(raw.amount)
    if (parseMoney(amount) === null) throw new CashError('Amount must be a plain number')

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const closed = await tx<{ id: string }[]>`select id from day_closes where restaurant_id = ${rid} limit 1`
      if (closed[0]) {
        throw new CashError(
          'Closes exist — the opening now comes from the previous day’s counted cash, never from a setting',
        )
      }
      await tx`
        insert into settings (restaurant_id, key, value)
        values (${rid}, 'first_opening_cash', ${amount})
        on conflict (restaurant_id, key) do update set value = excluded.value`
    })

    const [row] = await sql<{ value: string | null }[]>`
      select value from settings where restaurant_id = ${rid} and key = 'first_opening_cash'`
    if (!row?.value) throw new CashError('Could not verify the setting after save')
    return { ok: true, value: row.value }
  } catch (e) {
    return fail(e)
  }
}

// --------------------------------------------------------------- close day

const CloseSchema = z.object({
  date: z.string().regex(DATE_RE),
  extraCashIn: z.union([z.literal(''), moneyStr]),
  handedOver: z.union([z.literal(''), moneyStr]),
  handedTo: z.string().trim().max(120),
  cashCounted: moneyStr,
  bankSettled: z.union([z.literal(''), moneyStr]),
  note: z.string().trim().max(300),
})

export async function closeDay(raw: CloseDayInput): Promise<CloseDayResult> {
  try {
    const input = CloseSchema.parse(raw)
    assertRealDate(input.date, 'Close date')
    if (input.date > todayIST()) throw new CashError('That day has not happened yet')
    const handed = input.handedOver === '' ? 0 : (parseMoney(input.handedOver) ?? 0)
    if (handed > 0 && input.handedTo === '') throw new CashError('Handed over to whom? Name the person')
    if (parseMoney(input.cashCounted) === null) throw new CashError('Counted cash must be a plain amount')

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      // The chain law re-checked inside the lock: HARD STOP if D-1 is open.
      const prefill = await getClosePrefill(rid, input.date)
      if (!prefill.ok) throw new CashError(prefill.error)
      await tx`
        insert into day_closes (restaurant_id, close_date, opening_cash, extra_cash_in,
                                handed_over, handed_to, cash_counted, bank_settled, note)
        values (${rid}, ${input.date}, ${prefill.opening},
                ${input.extraCashIn === '' ? '0' : input.extraCashIn},
                ${input.handedOver === '' ? '0' : input.handedOver},
                ${handed > 0 ? cleanName(input.handedTo) : null},
                ${input.cashCounted},
                ${input.bankSettled === '' ? null : input.bankSettled},
                ${input.note === '' ? null : input.note})`
    })

    const ladder = await getLadderDay(rid, input.date)
    if (!ladder) throw new CashError('Could not read the close back from day_close_ladder')
    return { ok: true, ladder }
  } catch (e) {
    return fail(e)
  }
}
