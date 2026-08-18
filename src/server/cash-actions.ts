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
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { AccountRefusal, assertAccount } from '@/server/accounts-queries'
import { enteredBy } from '@/server/current-user'
import {
  getClosePrefill,
  getLadderDay,
  getOtherIncome,
  getVoucher,
} from '@/server/cash-queries'
import { nextDocNo } from '@/server/doc-numbers'
import { parseMoney, parseQty } from '@/lib/money'
import type {
  CloseDayInput,
  CloseDayResult,
  OtherIncomeRow,
  SaveOtherIncomesInput,
  SaveOtherIncomesResult,
  SaveVouchersInput,
  SaveVouchersResult,
  VoucherRow,
  SetOpeningResult,
} from '@/lib/types'
import { businessToday } from '@/server/business-day'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const moneyStr = z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'plain amount, up to 2 decimals')

class CashError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof CashError) return { ok: false, error: e.message }
  // A refusal to guess is not a failure — it names the missing answer, so
  // it reaches the user in its own words rather than wrapped in an apology.
  if (e instanceof AccountRefusal) return { ok: false, error: e.message }
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


const IncomeLineSchema = z.object({
  accountId: z.string().trim(),
  item: z.string().trim().min(1, 'What was sold?').max(120),
  qty: z.string().trim(),
  unit: z.string().trim(),
  amount: moneyStr,
  buyer: z.string().trim().max(120),
  receivedBy: z.string().trim().max(120),
})

const IncomesSchema = z.object({
  date: z.string().regex(DATE_RE),
  lines: z.array(IncomeLineSchema).min(1, 'Nothing to record').max(40),
})

/**
 * Header is ONLY the date — argued for this form, not copied.
 *
 * The tempting header was the BUYER: a scrap dealer taking cardboard and oil
 * in one visit really is one buyer. But a day's sundries just as often means
 * a dealer, a vending commission and a staff sale, which share nothing but
 * the day. Per line is never wrong, and the name picker makes repetition
 * cheap. `received_by` is per line for the same reason it is an
 * accountability field: if two people took money, the record should say so.
 *
 * No document number: other_income is not one of the numbered series.
 */
export async function saveOtherIncomes(raw: SaveOtherIncomesInput): Promise<SaveOtherIncomesResult> {
  try {
    const input = IncomesSchema.parse(raw)
    assertRealDate(input.date, 'Income date')

    for (const l of input.lines) {
      const what = l.item.trim() === '' ? 'That line' : l.item.trim()
      const amount = parseMoney(l.amount)
      if (amount === null || amount <= 0) throw new CashError(`${what}: amount must be more than zero`)
      // A quantity requires its unit — oil is sold in litres, and the FSSAI
      // expects the reconciliation.
      if (l.qty !== '') {
        const q = parseQty(l.qty)
        if (q === null || q <= 0) throw new CashError(`${what}: quantity must be a plain number more than zero`)
        if (l.unit === '') {
          throw new CashError(
            `${what}: a quantity needs its unit — oil is sold in litres, and the FSSAI expects the reconciliation`,
          )
        }
      }
      if (l.unit !== '' && l.qty === '') throw new CashError(`${what}: a unit needs its quantity`)
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const accountIds: string[] = []
    for (const l of input.lines) {
      const what = l.item.trim() === '' ? 'that line' : l.item.trim()
      accountIds.push(await assertAccount(rid, l.accountId, `the account ${what} landed in`))
    }

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const ids: string[] = []
      for (const [i, l] of input.lines.entries()) {
        if (l.unit !== '') {
          const unit = await tx<{ code: string }[]>`select code from units where code = ${l.unit}`
          if (!unit[0]) throw new CashError(`${l.item}: unknown unit`)
        }
        const [row] = await tx<{ id: string }[]>`
          insert into other_income (restaurant_id, income_date, item, qty, unit, amount, buyer, received_by, entered_by, account_id)
          values (${rid}, ${input.date}, ${l.item}, ${l.qty === '' ? null : l.qty},
                  ${l.unit === '' ? null : l.unit}, ${l.amount},
                  ${l.buyer === '' ? null : cleanName(l.buyer)},
                  ${l.receivedBy === '' ? null : cleanName(l.receivedBy)}, ${by}, ${accountIds[i]})
          returning id`
        ids.push(row.id)
      }
      return ids
    })

    const rows: OtherIncomeRow[] = []
    for (const id of saved) {
      const r = await getOtherIncome(rid, id)
      if (!r) throw new CashError('Could not verify the save — an income row is missing after commit')
      rows.push(r)
    }
    const total = rows.reduce((n, r) => n + Number(r.amount), 0).toFixed(2)
    return { ok: true, rows, total }
  } catch (e) {
    return fail(e)
  }
}

// ---------------------------------------------------------------- voucher

const VoucherLineSchema = z.object({
  accountId: z.string().trim(),
  amount: moneyStr,
  paidTo: z.string().trim().min(1, 'Who was paid?').max(120),
  paidBy: z.enum(['cashier', 'owner']),
  ownerName: z.string().trim().max(120),
  category: z.string().trim().max(60),
  note: z.string().trim().max(300),
  isStockPurchase: z.boolean(),
  isCasualLabour: z.boolean(),
})

const VouchersSchema = z.object({
  date: z.string().regex(DATE_RE),
  lines: z.array(VoucherLineSchema).min(1, 'Nothing to record').max(40),
})

/**
 * N vouchers, N DOCUMENT NUMBERS.
 *
 * A batch is a convenience of ENTRY, not a document. Three payments made in
 * one sitting are three payments: different payees, individually voidable,
 * individually cited by an accountant months later. One number across three
 * would change meaning the instant one of them was voided — and a document
 * number has to mean exactly one thing forever, including when that thing was
 * a mistake.
 *
 * `saveShorts` batches under ONE header id and that is not an inconsistency:
 * there the header is THE BILL, a document that already exists and is already
 * numbered, and the shorts hang off it. Here the header is a date — a
 * keystroke saving. Ask what the header IS: a document lends its identity, a
 * convenience lends nothing.
 *
 * The number is drawn on the TRANSACTION handle, so a failed line burns no
 * number and the series stays gapless. Errors name the PAYEE, because that is
 * what the cashier sees on the screen and on the slip in their hand.
 */
export async function saveVouchers(raw: SaveVouchersInput): Promise<SaveVouchersResult> {
  try {
    const input = VouchersSchema.parse(raw)
    assertRealDate(input.date, 'Voucher date')

    const prepared = input.lines.map((l) => {
      const who = l.paidTo.trim() === '' ? 'That payment' : l.paidTo.trim()
      const amount = parseMoney(l.amount)
      if (amount === null || amount <= 0) throw new CashError(`${who}: amount must be more than zero`)

      // A payment is ONE kind of thing. Both flags true would put the same
      // amount inside cost of goods AND on the labour line — one rupee in two
      // totals, and nothing on any screen looking wrong. The form asks it as
      // a single three-way question; this is the check, because a form is
      // never the check.
      if (l.isStockPurchase && l.isCasualLabour) {
        throw new CashError(
          `${who}: a payment is either goods for the kitchen or a day hand's wages, not both — counting it twice would inflate food cost and labour together`,
        )
      }

      const category = (l.category === '' ? 'general' : l.category).toLowerCase().replace(/\s+/g, '_')
      if (l.paidBy === 'owner' && l.ownerName === '') {
        throw new CashError(`${who}: owner-funded — pick which owner paid, so the debt lands in their ledger`)
      }
      if (l.paidBy === 'owner' && category === 'owner_reimbursement') {
        throw new CashError(`${who}: a reimbursement is paid by the cashier from the drawer — not by an owner`)
      }
      return { ...l, category }
    })

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    // Per line, because an owner-funded payment leaves the owner's own
    // account while a cashier payment leaves the drawer. Resolved BEFORE the
    // transaction so an AccountRefusal reaches the user in its own words.
    const accountIds: string[] = []
    for (const l of prepared) {
      const who = l.paidTo.trim() === '' ? 'That payment' : l.paidTo.trim()
      accountIds.push(await assertAccount(rid, l.accountId, `the account ${who} was paid from`))
    }

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const ids: string[] = []
      for (const [i, l] of prepared.entries()) {
        // The voucher's own date, not today: a voucher written up late still
        // belongs to the financial year the money moved in. One draw per
        // line, on the tx, so a rollback consumes no number.
        const docNo = await nextDocNo(tx, rid, 'VCH', input.date)
        const [row] = await tx<{ id: string }[]>`
          insert into cash_vouchers (restaurant_id, voucher_date, amount, paid_to, paid_by, owner_name, category, note, entered_by, is_stock_purchase, is_casual_labour, account_id, doc_no)
          values (${rid}, ${input.date}, ${l.amount}, ${cleanName(l.paidTo)}, ${l.paidBy},
                  ${l.paidBy === 'owner' ? cleanName(l.ownerName) : null}, ${l.category},
                  ${l.note === '' ? null : l.note}, ${by}, ${l.isStockPurchase}, ${l.isCasualLabour}, ${accountIds[i]}, ${docNo})
          returning id`
        ids.push(row.id)
      }
      return ids
    })

    const vouchers: VoucherRow[] = []
    for (const id of saved) {
      const v = await getVoucher(rid, id)
      if (!v) throw new CashError('Could not verify the save — a voucher is missing after commit')
      vouchers.push(v)
    }
    const total = vouchers.reduce((n, v) => n + Number(v.amount), 0).toFixed(2)
    return { ok: true, vouchers, total }
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

    await txn(async (tx) => {
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

    const [row] = await tsql<{ value: string | null }[]>`
      select value from settings where restaurant_id = ${rid} and key = 'first_opening_cash'`
    if (!row?.value) throw new CashError('Could not verify the setting after save')
    return { ok: true, value: row.value }
  } catch (e) {
    return fail(e)
  }
}

// --------------------------------------------------------------- close day

const CloseSchema = z.object({
  bankAccountId: z.string().trim(),
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
    if (input.date > await businessToday()) throw new CashError('That day has not happened yet')
    const handed = input.handedOver === '' ? 0 : (parseMoney(input.handedOver) ?? 0)
    if (handed > 0 && input.handedTo === '') throw new CashError('Handed over to whom? Name the person')
    if (parseMoney(input.cashCounted) === null) throw new CashError('Counted cash must be a plain amount')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()
    // Conditional: only a day that actually settled money into a bank names
    // the account it went to. A blank bank block moved nothing, so demanding
    // an account there would be inventing a journey.
    const bankAccountId =
      input.bankSettled === '' || parseMoney(input.bankSettled) === 0
        ? null
        : await assertAccount(rid, input.bankAccountId, 'the account the bank settlement went into')

    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      // The chain law re-checked inside the lock: HARD STOP if D-1 is open.
      // `tx` is lent so the re-read happens IN this transaction rather than
      // opening a second one on a second connection while this one holds the
      // advisory lock.
      const prefill = await getClosePrefill(rid, input.date, tx as unknown as typeof tsql)
      if (!prefill.ok) throw new CashError(prefill.error)
      await tx`
        insert into day_closes (restaurant_id, close_date, opening_cash, extra_cash_in,
                                handed_over, handed_to, cash_counted, bank_settled, note, entered_by, bank_account_id)
        values (${rid}, ${input.date}, ${prefill.opening},
                ${input.extraCashIn === '' ? '0' : input.extraCashIn},
                ${input.handedOver === '' ? '0' : input.handedOver},
                ${handed > 0 ? cleanName(input.handedTo) : null},
                ${input.cashCounted},
                ${input.bankSettled === '' ? null : input.bankSettled},
                ${input.note === '' ? null : input.note}, ${by}, ${bankAccountId})`
    })

    const ladder = await getLadderDay(rid, input.date)
    if (!ladder) throw new CashError('Could not read the close back from day_close_ladder')
    return { ok: true, ladder }
  } catch (e) {
    return fail(e)
  }
}
