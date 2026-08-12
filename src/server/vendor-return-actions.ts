'use server'

// Write side of goods going BACK to the vendor.
//
// Kitchen→store returns already existed; store→vendor did not, so bad goods
// went back and the credit that lands on the next bill had nowhere to be
// recorded. Three verbs: record the return, void one entered in error, and
// record the credit note when it finally arrives.
//
// STOCK IS NOT WRITTEN HERE, AND MUST NOT BE. stock_on_hand already subtracts
// sum(vendor_return_lines.qty) — writing a stock_adjustments row as well would
// take the same goods off the book twice, and nothing on screen would look
// wrong. This is the tempting place to add one; do not.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { parseMoney, parseQty } from '@/lib/money'
import {
  VendorReturnRefusal,
  assertItems,
  assertPurchaseForVendor,
  assertVendor,
  getVendorReturn,
} from '@/server/vendor-return-queries'
import type { VendorReturnInput, VendorReturnResult } from '@/lib/types'
import type { Role } from '@/lib/roles'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof VendorReturnRefusal) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('vendor return action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

/** Who is asking, checked against the DATABASE every time — a server action is
 *  a public endpoint and the route gate is not the check. */
async function actor(what: string): Promise<string> {
  const allowed: Role[] = ['store', 'manager', 'owner']
  const user = await getSessionUser()
  if (!user) throw new VendorReturnRefusal('Sign in again — the session has expired')
  if (!allowed.includes(user.role)) {
    throw new VendorReturnRefusal(`${what} is the store's job — ask them, or a manager`)
  }
  return user.username
}

/* ── record the return ──────────────────────────────────────────────────── */

const LineSchema = z.object({
  itemId: z.string().regex(UUID),
  qty: z.string().trim().min(1, 'How much went back?'),
  rate: z.string().trim().min(1, 'What is the credit claimed at?'),
})

const ReturnSchema = z.object({
  date: z.string().regex(DATE_RE),
  vendorId: z.string().trim(),
  reason: z.string().trim().min(1, 'Say why the goods went back').max(300),
  creditNoteRef: z.string().trim().max(120),
  note: z.string().trim().max(300),
  lines: z.array(LineSchema),
})

/**
 * Header and lines in ONE transaction.
 *
 * The RATE is what the credit is CLAIMED at — normally the rate off the bill
 * the goods arrived on. It is typed rather than looked up because a vendor
 * does not always credit at the price they charged, and quietly substituting
 * the bill rate would make the app state a claim nobody made.
 *
 * vendor_return_lines.amount is GENERATED (qty × rate) and is therefore absent
 * from the insert column list by necessity — the same trap as bill_total.
 */
export async function saveVendorReturn(raw: VendorReturnInput): Promise<VendorReturnResult> {
  try {
    const input = ReturnSchema.parse(raw)
    const by = await actor('Recording a vendor return')

    const d = new Date(`${input.date}T00:00:00Z`)
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.date) {
      throw new VendorReturnRefusal('The return date is not a real calendar date')
    }
    if (input.lines.length === 0) {
      throw new VendorReturnRefusal('A return with no items is not a return — add at least one line')
    }
    input.lines.forEach((l, i) => {
      const qty = parseQty(l.qty)
      if (qty === null || qty <= 0) {
        throw new VendorReturnRefusal(`Line ${i + 1}: the quantity going back must be more than zero`)
      }
      const rate = parseMoney(l.rate)
      if (rate === null || rate <= 0) {
        throw new VendorReturnRefusal(`Line ${i + 1}: the rate the credit is claimed at must be more than zero`)
      }
    })

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const vendor = await assertVendor(rid, input.vendorId)
    await assertItems(rid, input.lines.map((l) => l.itemId))

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [header] = await tx<{ id: string }[]>`
        insert into vendor_returns (restaurant_id, return_date, vendor_id, reason,
                                    credit_note_ref, note, entered_by)
        values (${rid}, ${input.date}, ${vendor.id}, ${input.reason},
                ${input.creditNoteRef === '' ? null : input.creditNoteRef},
                ${input.note === '' ? null : input.note}, ${by})
        returning id`
      if (!header) throw new VendorReturnRefusal('The return could not be saved')

      for (const line of input.lines) {
        await tx`
          insert into vendor_return_lines (vendor_return_id, item_id, qty, rate)
          values (${header.id}, ${line.itemId}, ${line.qty}::numeric, ${line.rate}::numeric)`
      }

      // Read the lines back inside the transaction: if the count does not
      // match what was sent, the header would commit carrying a claim for
      // goods that were never listed.
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int as n from vendor_return_lines where vendor_return_id = ${header.id}`
      if (n !== input.lines.length) {
        throw new VendorReturnRefusal('Verification failed: the lines did not all reach the return')
      }
      return header
    })

    const ret = await getVendorReturn(rid, saved.id)
    if (!ret) throw new VendorReturnRefusal('Could not verify the save — the return is missing after commit')
    return { ok: true, id: ret.id }
  } catch (e) {
    return fail(e)
  }
}

/* ── void one entered in error ──────────────────────────────────────────── */

/**
 * A REVERSAL, never a delete: the entry happened and stays on record.
 *
 * THE NEGATIVE TWIN IS NOT AVAILABLE HERE, and the reason is a CHECK
 * constraint, not a preference. Every other void in this app inserts
 * `select -qty, unit_cost` — but `vendor_return_lines` carries
 * CHECK (qty > 0), so a negative quantity is refused by the database. The
 * negation therefore moves to the only column that can carry it: the RATE.
 * qty is copied EXACTLY, rate is negated, and `amount` (GENERATED as
 * qty × rate) comes out as the exact negative of the original.
 *
 * WHAT THAT FIXES AND WHAT IT DOES NOT:
 *
 *   MONEY — exact. vendor_dues.credits and vendor_performance.returned_value
 *   both sum vendor_return_lines.amount, so the pair nets to zero and the
 *   vendor's balance returns to what it was. This is the number that matters
 *   most: nobody physically counts what we owe a supplier, so a wrong credit
 *   here is never discovered — it is simply underpaid.
 *
 *   STOCK — left WORSE, and said so on screen. stock_on_hand subtracts
 *   sum(vendor_return_lines.qty) with no reference to vendor_returns at all,
 *   so it cannot tell a reversal from a return and takes the reversal's own
 *   (positive) quantity off as well: after a void the book is short by TWICE
 *   what went back. It is NOT patched up from here — putting stock back is a
 *   deliberate judgement someone makes on a stock adjustment, the same rule
 *   that stops a count auto-correcting the book, and the next physical count
 *   finds it either way.
 *
 * Verified in a transaction that was rolled back: a 10 × ₹50 return moved the
 * vendor balance 3000 → 2500 and returned_value 0 → 500; the void moved both
 * back exactly (3000, 0) and moved stock 4 → −6 → −16.
 *
 * WHY THAT TRADE, and not the other way round: nobody physically counts what
 * we owe a supplier, so a credit left standing after a void is never
 * discovered — it is simply underpaid, month after month. A wrong book
 * quantity is found by the next count, loudly. So the money is made exact and
 * the stock gap is stated in words.
 *
 * The real fix is a migration (relax the CHECK, or teach the views to skip a
 * reversed pair). Until then this is on screen, not hidden.
 */
/**
 * REFUSED, DELIBERATELY, until stock_on_hand can tell a reversal from a
 * return. This is not caution — it is measured: 18.5 on hand, a return of
 * 10 leaves 8.5, and voiding it leaves −1.5. The quantity comes off TWICE.
 *
 * Why it cannot be fixed here: `vendor_return_lines` carries
 * CHECK (qty > 0), so a reversal cannot be the negative twin every other
 * void in this app is — the negation has to go on `rate`, which reverses
 * the money and not the goods. `stock_on_hand` then subtracts
 * sum(vendor_return_lines.qty) with no reference to `vendor_returns
 * .reverses_id`, so it counts the original and the reversal alike.
 *
 * Writing a compensating stock_adjustments row would hide it and break the
 * one-path rule: goods move through exactly one table. So the button
 * refuses and names the fix, because a void that corrupts the book is
 * worse than no void at all. The migration needed is one line in the view:
 * count only LIVE returns — those with no reverses_id, and not themselves
 * reversed — exactly as `bills.is_voided` already does for purchases.
 */
export async function voidVendorReturn(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID.test(id)) return { ok: false, error: 'Malformed return id' }
  return {
    ok: false,
    error:
      'Voiding a return would take the stock off twice — stock_on_hand cannot yet tell a reversal from a return. Until that view counts only live returns, correct it with a stock adjustment instead.',
  }
}

export async function recordCreditNote(
  id: string,
  ref: string,
  settledAgainstPurchaseId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!UUID.test(id)) throw new VendorReturnRefusal('Malformed return id')
    const cleanRef = ref.trim()
    if (cleanRef === '') {
      throw new VendorReturnRefusal('Type the credit note number the vendor issued — that is the thing being recorded')
    }
    if (settledAgainstPurchaseId !== '' && !UUID.test(settledAgainstPurchaseId)) {
      throw new VendorReturnRefusal('Malformed bill id')
    }
    await actor('Recording a credit note')
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const ret = await getVendorReturn(rid, id)
    if (!ret) throw new VendorReturnRefusal('That return is not on file')
    if (ret.is_reversal) throw new VendorReturnRefusal('This row is a reversal — it claims nothing, so no credit note belongs on it')
    if (ret.is_voided) throw new VendorReturnRefusal('This return was voided — the claim was withdrawn, so there is no credit to record')

    const purchaseId =
      settledAgainstPurchaseId === ''
        ? null
        : await assertPurchaseForVendor(rid, ret.vendor_id, settledAgainstPurchaseId)

    const [row] = await sql<{ id: string }[]>`
      update vendor_returns
      set credit_note_ref = ${cleanRef.slice(0, 120)},
          settled_against_purchase_id = ${purchaseId}
      where id = ${id} and restaurant_id = ${rid}
      returning id`
    if (!row) throw new VendorReturnRefusal('Nothing was changed — reload and try again')

    const saved = await getVendorReturn(rid, id)
    if (!saved || saved.credit_note_ref !== cleanRef.slice(0, 120)) {
      throw new VendorReturnRefusal('Verification failed: the credit note did not read back')
    }
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
