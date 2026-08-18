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
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { parseMoney, parseQty } from '@/lib/money'
import {
  VendorReturnRefusal,
  assertItems,
  assertPurchaseForVendor,
  assertSourceLine,
  assertVendor,
  getVendorReturn,
} from '@/server/vendor-return-queries'
import { getList } from '@/server/settings'
import { noteListSuggestion } from '@/server/settings-actions'
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
  /** PER LINE. A rotten crate and a wrong item go back on the same trip for
   *  two different reasons, and one of them is a quality problem with the
   *  supplier while the other is a picking mistake. Collapsing both onto the
   *  header would lose the distinction the vendor conversation turns on. */
  reason: z.string().trim().min(1, 'Say why this line is going back').max(120),
  /** provenance for the rate — blank is allowed */
  sourcePurchaseLineId: z.string().trim(),
})

const ReturnSchema = z.object({
  date: z.string().regex(DATE_RE),
  vendorId: z.string().trim(),
  creditNoteRef: z.string().trim().max(120),
  note: z.string().trim().max(300),
  lines: z.array(LineSchema),
})

/**
 * Header and lines in ONE transaction.
 *
 * The RATE is what the credit is CLAIMED at, and it stays EDITABLE — a vendor
 * does not always credit at the price they charged, so the app must be able to
 * state a claim that differs from the bill. What changed is that it is no
 * longer typed from memory: the form prefills it from
 * `vendor_supplied_items.last_rate` and records
 * `source_purchase_line_id` beside it, so the number has a provenance. The old
 * screen said "normally the rate on the bill these arrived on", which was the
 * app asking somebody to remember something the database was holding.
 *
 * A PREFILL IS NOT A SUBSTITUTION. The rate arrives filled in and the receiver
 * can change it; nothing is written that nobody looked at.
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

    // Every source line must be one of THIS vendor's. Resolved once per
    // distinct id rather than per line, because a bill-opened return usually
    // names several lines off one bill.
    const sourceIds = new Map<string, string | null>()
    for (const l of input.lines) {
      if (sourceIds.has(l.sourcePurchaseLineId)) continue
      sourceIds.set(l.sourcePurchaseLineId, await assertSourceLine(rid, vendor.id, l.sourcePurchaseLineId))
    }

    // LAW 2 AS AMENDED: a typed reason SAVES and lands in list_suggestions as
    // pending. Refusing it would stop the work — and the person holding a
    // rotten crate at the vendor's van cannot wait for an owner to log in.
    // Checked outside the transaction and once per distinct value.
    const known = await getList(rid, 'vendor_return_reason')
    const lower = new Set(known.map((r) => r.toLowerCase()))
    for (const value of new Set(input.lines.map((l) => l.reason))) {
      if (!lower.has(value.toLowerCase())) await noteListSuggestion(rid, 'vendor_return_reason', value, by)
    }

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      // NO HEADER REASON. It is nullable now and stays null on purpose: a
      // cached predominant reason could disagree with the lines it claims to
      // summarise, and nothing on screen would look wrong. The list reads the
      // lines and says "Quality" or "Mixed".
      const [header] = await tx<{ id: string }[]>`
        insert into vendor_returns (restaurant_id, return_date, vendor_id,
                                    credit_note_ref, note, entered_by)
        values (${rid}, ${input.date}, ${vendor.id},
                ${input.creditNoteRef === '' ? null : input.creditNoteRef},
                ${input.note === '' ? null : input.note}, ${by})
        returning id`
      if (!header) throw new VendorReturnRefusal('The return could not be saved')

      for (const line of input.lines) {
        await tx`
          insert into vendor_return_lines (restaurant_id, vendor_return_id, item_id, qty, rate,
                                           reason, source_purchase_line_id)
          values (${rid}, ${header.id}, ${line.itemId}, ${line.qty}::numeric, ${line.rate}::numeric,
                  ${line.reason}, ${sourceIds.get(line.sourcePurchaseLineId) ?? null})`
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
 * A negative twin is not available here, so the reversal is marked on the
 * PARENT and every view that reads the lines filters on the parent's state.
 *
 * WHY NOT THE NEGATIVE TWIN: `vendor_return_lines` carries CHECK (qty > 0), so
 * the quantity cannot be negated. Every line is therefore copied EXACTLY — qty,
 * rate, reason, provenance — and `vendor_returns.reverses_id` is what says the
 * pair no longer stands. A reversal states the claim AS IT WAS MADE, not as
 * anybody would describe it today.
 *
 * THE GENERAL RULE, and this is the third view-set in the project to need it:
 * a CHECK (qty > 0) on a line table means that table can never use the
 * negative-twin void, so when you find one, GREP FOR THE PARENT, NOT THE LINE.
 * Four views read these lines and all four now filter:
 * `stock_on_hand`, `vendor_dues.credits`, `vendor_performance.returned_value`
 * and `vendor_return_reasons`. The first learned it in migration 0022 and the
 * other three in `money_views_skip_reversed_returns` — and in between, the void
 * was REFUSED rather than left to overstate a supplier credit that nobody would
 * ever have noticed.
 *
 * Measured on live data inside a transaction that rolled back, ₹500 of Chicken
 * Boneless going back to Golden Mutton — the void must return EVERY column to
 * where it started, and does:
 *
 *                    balance   credits   returned   on hand   reasons
 *   before             17050         0          0      23.5   —
 *   after the return   16550       500        500      13.5   Quality 1 / 500
 *   after the VOID     17050         0          0      23.5   —
 *
 * `smoke:a2` asserts all five of those columns rather than the money alone.
 * The gate that used to hold the refusal in place was an INVARIANT
 * (refusal in force iff the views doubled), so it went red the day the
 * migration landed instead of quietly agreeing with a pinned bug.
 */
export async function voidVendorReturn(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!UUID.test(id)) throw new VendorReturnRefusal('Malformed return id')
    const by = await actor('Voiding a vendor return')
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      const [orig] = await tx<{ id: string; return_date: string; vendor_id: string; reverses_id: string | null }[]>`
        select id, return_date::text as return_date, vendor_id, reverses_id
        from vendor_returns where id = ${id} and restaurant_id = ${rid}`
      if (!orig) throw new VendorReturnRefusal('That return no longer exists')
      if (orig.reverses_id !== null) {
        throw new VendorReturnRefusal('That is already a reversal — it cannot be voided in turn')
      }
      const [already] = await tx<{ id: string }[]>`
        select id from vendor_returns where reverses_id = ${id} limit 1`
      if (already) throw new VendorReturnRefusal('That return is already voided')

      // same date as the original, so the months cancel cleanly
      const [rev] = await tx<{ id: string }[]>`
        insert into vendor_returns (restaurant_id, return_date, vendor_id, reason, reverses_id, entered_by)
        values (${rid}, ${orig.return_date}, ${orig.vendor_id}, 'void', ${id}, ${by})
        returning id`
      // amount is GENERATED — absent from the column list by necessity
      // reason and provenance are copied EXACTLY, like unit_cost on an issue
      // void: a reversal states the claim as it was MADE, not as anybody would
      // describe it today.
      await tx`
        insert into vendor_return_lines (restaurant_id, vendor_return_id, item_id, qty, rate,
                                         reason, source_purchase_line_id)
        select restaurant_id, ${rev.id}, item_id, qty, rate, reason, source_purchase_line_id
        from vendor_return_lines where vendor_return_id = ${id}`

      const [check] = await tx<{ n: number }[]>`
        select count(*)::int as n from vendor_return_lines where vendor_return_id = ${rev.id}`
      if (!check || check.n === 0) throw new VendorReturnRefusal('The reversal copied no lines — nothing was written')
    })

    return { ok: true }
  } catch (e) {
    return fail(e)
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

    const [row] = await tsql<{ id: string }[]>`
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
