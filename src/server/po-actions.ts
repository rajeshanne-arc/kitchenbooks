'use server'

// PURCHASE ORDERS — the write side, and the freeze.
//
// DRAFT IS EDITABLE, SENT IS FROZEN. This is the "editable, then frozen" rule
// in its clearest form yet, and the clearest instance of why that rule lives
// in code: a draft asserts an INTENTION and nothing depends on it. The instant
// it is sent, the ordered quantity becomes the thing a short is measured
// against — `po_fulfilment.gap` is delivered − ordered — so editing the ask
// afterwards would rewrite a claim against a vendor retroactively. That is the
// same fault the indent freeze exists to prevent, with money and somebody
// else's business on the other end of it.
//
// THE GRANTS PERMIT WHAT THE RULE FORBIDS, deliberately. kb_app may UPDATE
// qty, rate and note on a line and may DELETE a line, because a draft needs
// both. The database cannot know whether the parent has been sent, so the rule
// is enforced here — and it is re-read INSIDE THE TRANSACTION, under a row
// lock, not on the page and not before it: an order sent from another phone
// while this form was open must still stop the save.
//
// A SENT ORDER CAN BE CANCELLED, NEVER EDITED. Cancelling says "ignore that
// one"; editing says "you misread it". Only the first is honest once a vendor
// is holding a copy.

import { z } from 'zod'
import { txn, tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { nextDocNo } from '@/server/doc-numbers'
import { PoLineRefusal, assertOneRowPerItem } from '@/server/po-queries'
import { parseMoney, parseQty } from '@/lib/money'
import type { PurchaseOrderRow, SentVia } from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

class PoError extends Error {}

export type PoResult = { ok: true; id: string; doc_no: string | null } | { ok: false; error: string }
export type PoSendResult = { ok: true; po: PurchaseOrderRow } | { ok: false; error: string }

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof PoError) return { ok: false, error: e.message }
  // Its own words, not the generic apology — the same handling AccountRefusal gets.
  if (e instanceof PoLineRefusal) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('purchase order action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

/** A server action is a public endpoint and the route gate is not the check.
 *  The store raises and sends orders; manager and owner may do anything the
 *  store may. */
async function actor(): Promise<{ username: string }> {
  const user = await getSessionUser()
  if (!user) throw new PoError('Sign in again — the session has expired')
  if (user.role !== 'store' && user.role !== 'manager' && user.role !== 'owner') {
    throw new PoError('Only the store, a manager or an owner can raise a purchase order — ask them')
  }
  return { username: user.username }
}

function assertRealDate(s: string, label: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new PoError(`${label} is not a real calendar date`)
  }
}

const LineSchema = z.object({
  itemId: z.string().regex(UUID),
  qty: z.string().trim().min(1),
  rate: z.string().trim(),
  note: z.string().trim().max(300),
})

const SaveSchema = z.object({
  vendorId: z.string().regex(UUID),
  poDate: z.string().regex(DATE_RE),
  expectedDate: z.union([z.literal(''), z.string().regex(DATE_RE)]),
  note: z.string().trim().max(500),
  lines: z.array(LineSchema).min(1).max(200),
})

export type SavePoInput = z.infer<typeof SaveSchema>

/** Parse the lines once, so create and update refuse identically. */
function parseLines(lines: SavePoInput['lines']) {
  return lines.map((l, i) => {
    const q = parseQty(l.qty)
    if (q === null || q <= 0) throw new PoError(`Line ${i + 1}: quantity must be more than zero`)
    // A RATE MAY BE BLANK AND MUST NOT BE INVENTED. This vendor may never have
    // billed this item, and an order quoting a price they never gave is worse
    // than one leaving it open — a blank invites a question, a wrong number
    // invites agreement.
    const r = l.rate === '' ? 0 : parseMoney(l.rate)
    if (r === null || r < 0) throw new PoError(`Line ${i + 1}: rate is not a valid amount`)
    return { itemId: l.itemId, qty: l.qty.trim(), rate: (r / 100).toFixed(2), note: l.note }
  })
}

/**
 * A new order, always a DRAFT.
 *
 * THE NUMBER IS ALLOCATED HERE, not at send. Every other numbered row in this
 * app carries its number from birth, a void keeps its number, and the series
 * is gapless by construction — so a cancelled order keeps its number too and
 * nothing is ever reused or renumbered. Allocated on the TRANSACTION handle so
 * the number and the row it belongs to commit or roll back together.
 */
export async function createPurchaseOrder(raw: SavePoInput): Promise<PoResult> {
  try {
    const input = SaveSchema.parse(raw)
    assertRealDate(input.poDate, 'The order date')
    if (input.expectedDate !== '') assertRealDate(input.expectedDate, 'The expected date')
    const who = await actor()
    const lines = parseLines(input.lines)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    return await txn(async (tx) => {
      const [vendor] = await tx<{ id: string }[]>`
        select id from vendors
        where id = ${input.vendorId} and restaurant_id = ${rid} and status = 'active'`
      if (!vendor) throw new PoError('That vendor is not on the active list — pick another')
      // BEFORE THE NUMBER IS DRAWN. The transaction rolls back either way, so
      // the series stays gapless — but refusing first keeps the failure about
      // the order rather than about numbering.
      await assertOneRowPerItem(tx, rid, lines)

      const docNo = await nextDocNo(tx, rid, 'PO', input.poDate)
      const [po] = await tx<{ id: string }[]>`
        insert into purchase_orders
          (restaurant_id, doc_no, vendor_id, po_date, expected_date, status, note, entered_by)
        values (${rid}, ${docNo}, ${input.vendorId}, ${input.poDate}::date,
                ${input.expectedDate === '' ? null : input.expectedDate}::date,
                'draft', ${input.note === '' ? null : input.note}, ${who.username})
        returning id`

      const rows = lines.map((l) => ({
        restaurant_id: rid,
        purchase_order_id: po.id,
        item_id: l.itemId,
        qty: l.qty,
        rate: l.rate,
        note: l.note === '' ? null : l.note,
      }))
      await tx`insert into purchase_order_lines ${tx(rows, 'restaurant_id', 'purchase_order_id', 'item_id', 'qty', 'rate', 'note')}`
      return { ok: true as const, id: po.id, doc_no: docNo }
    })
  } catch (e) {
    return fail(e)
  }
}

/**
 * Replace a DRAFT's lines and header. Refused for anything else, by name.
 *
 * THE FREEZE IS RE-READ INSIDE THE TRANSACTION, under `for update`. Checking
 * on the page, or before the lock, would let an order sent from another phone
 * while this form was open be silently overwritten — and the vendor would be
 * holding a document that no longer matches what we claim we asked for.
 *
 * The vendor and the order date are NOT updatable: kb_app holds no UPDATE
 * grant on either, which is the database agreeing with the rule. A different
 * vendor is a different order.
 */
export async function updatePurchaseOrder(id: string, raw: SavePoInput): Promise<PoResult> {
  try {
    if (!UUID.test(id)) throw new PoError('That order does not exist')
    const input = SaveSchema.parse(raw)
    if (input.expectedDate !== '') assertRealDate(input.expectedDate, 'The expected date')
    await actor()
    const lines = parseLines(input.lines)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    return await txn(async (tx) => {
      const [po] = await tx<
        { id: string; status: string; doc_no: string | null; vendor_id: string }[]
      >`
        select id, status, doc_no, vendor_id from purchase_orders
        where id = ${id} and restaurant_id = ${rid}
        for update`
      if (!po) throw new PoError('That order does not exist')
      if (po.status !== 'draft') {
        throw new PoError(
          po.status === 'cancelled'
            ? 'That order was cancelled — raise a new one rather than editing it'
            : `${po.doc_no ?? 'That order'} has already been sent, so what was ordered is now what a short is measured against. Cancel it and raise a new one.`,
        )
      }
      // Belt and braces with the missing UPDATE grant: a different vendor is a
      // different order, and the refusal says so rather than letting the
      // database answer with a permission error nobody can read.
      if (input.vendorId !== po.vendor_id) {
        throw new PoError('An order cannot change vendor — raise a new one')
      }
      // BEFORE THE DELETE, not after the insert. Refusing later would still be
      // safe — the transaction rolls back — but it would have thrown away the
      // draft's lines to discover something knowable from the payload alone.
      await assertOneRowPerItem(tx, rid, lines)

      // The lines are REPLACED, which is what the DELETE grant is for: a draft
      // line asserts an intention and nothing reads it yet.
      await tx`delete from purchase_order_lines
               where restaurant_id = ${rid} and purchase_order_id = ${id}`
      const rows = lines.map((l) => ({
        restaurant_id: rid,
        purchase_order_id: id,
        item_id: l.itemId,
        qty: l.qty,
        rate: l.rate,
        note: l.note === '' ? null : l.note,
      }))
      await tx`insert into purchase_order_lines ${tx(rows, 'restaurant_id', 'purchase_order_id', 'item_id', 'qty', 'rate', 'note')}`
      await tx`update purchase_orders
               set expected_date = ${input.expectedDate === '' ? null : input.expectedDate}::date,
                   note = ${input.note === '' ? null : input.note}
               where id = ${id} and restaurant_id = ${rid}`
      return { ok: true as const, id, doc_no: po.doc_no }
    })
  } catch (e) {
    return fail(e)
  }
}

const SendSchema = z.object({
  id: z.string().regex(UUID),
  via: z.enum(['whatsapp', 'print', 'email', 'other']),
})

/**
 * Send it, and freeze it.
 *
 * `sent_at`, `sent_by` and `sent_via` are recorded because "did we actually
 * send it?" is the first question anybody asks about a delivery that has not
 * arrived, and "I think so" is not an answer a store manager should have to
 * give.
 *
 * SENDING DOES NOT DELIVER THE MESSAGE, and this records only what can be
 * observed. wa.me opens WhatsApp with the text prefilled and a human presses
 * send; the claim here is that it was handed over to be sent, not that it
 * arrived. That review step is the point, not a limitation — a document
 * involving money should be seen before it goes.
 */
export async function sendPurchaseOrder(raw: { id: string; via: SentVia }): Promise<PoSendResult> {
  try {
    const input = SendSchema.parse(raw)
    const who = await actor()
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const id = await txn(async (tx) => {
      const [po] = await tx<{ id: string; status: string; doc_no: string | null; lines: number }[]>`
        select p.id, p.status, p.doc_no,
               (select count(*)::int from purchase_order_lines l where l.purchase_order_id = p.id) as lines
        from purchase_orders p
        where p.id = ${input.id} and p.restaurant_id = ${rid}
        for update`
      if (!po) throw new PoError('That order does not exist')
      if (po.status === 'cancelled') throw new PoError('That order was cancelled')
      if (po.status !== 'draft') {
        throw new PoError(`${po.doc_no ?? 'That order'} was already sent — it cannot be sent twice`)
      }
      // AN EMPTY ORDER IS NOT AN ORDER. The lines could have been emptied by a
      // draft edit, and a vendor receiving a document with no items on it
      // learns only that we are not paying attention.
      if (po.lines === 0) throw new PoError('There is nothing on this order to send')

      await tx`update purchase_orders
               set status = 'sent', sent_at = now(), sent_by = ${who.username}, sent_via = ${input.via}
               where id = ${input.id} and restaurant_id = ${rid}`
      return po.id
    })

    // READ BACK FROM THE DATABASE, never echoed from the input — the phase-1
    // rule. The acknowledgement says what was actually recorded.
    const [po] = await tsql<PurchaseOrderRow[]>`
      select p.id, p.doc_no, p.vendor_id, v.code as vendor_code, v.name as vendor_name,
             v.phone as vendor_phone,
             p.po_date::text as po_date, p.expected_date::text as expected_date,
             p.status, p.note, p.sent_at::text as sent_at, p.sent_by, p.sent_via,
             p.entered_by,
             (select count(*)::int from purchase_order_lines l where l.purchase_order_id = p.id) as lines,
             (select coalesce(sum(l.amount), 0)::text from purchase_order_lines l
               where l.purchase_order_id = p.id) as total
      from purchase_orders p
      join vendors v on v.restaurant_id = p.restaurant_id and v.id = p.vendor_id
      where p.id = ${id} and p.restaurant_id = ${rid}`
    if (!po || po.status !== 'sent') throw new PoError('Could not verify the order after sending')
    return { ok: true, po }
  } catch (e) {
    return fail(e)
  }
}

/** Cancel — the only correction available once an order has gone out, and the
 *  honest one. The row and its number stay on the record; `po_fulfilment`
 *  already excludes cancelled orders, so no shortfall is ever computed against
 *  an order nobody was going to fill. */
export async function cancelPurchaseOrder(id: string, reason: string): Promise<PoResult> {
  try {
    if (!UUID.test(id)) throw new PoError('That order does not exist')
    const why = reason.trim()
    if (why === '') throw new PoError('Say why it is being cancelled — the reason is kept')
    await actor()
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    return await txn(async (tx) => {
      const [po] = await tx<{ id: string; status: string; doc_no: string | null; note: string | null }[]>`
        select id, status, doc_no, note from purchase_orders
        where id = ${id} and restaurant_id = ${rid}
        for update`
      if (!po) throw new PoError('That order does not exist')
      if (po.status === 'cancelled') throw new PoError('That order is already cancelled')
      if (po.status === 'received' || po.status === 'closed') {
        throw new PoError('Goods have already been received against this order — it cannot be cancelled')
      }
      const note = [po.note, `Cancelled: ${why}`].filter((x) => x !== null && x !== '').join(' · ')
      await tx`update purchase_orders set status = 'cancelled', note = ${note}
               where id = ${id} and restaurant_id = ${rid}`
      return { ok: true as const, id, doc_no: po.doc_no }
    })
  } catch (e) {
    return fail(e)
  }
}

/** Close it by hand — the delivery is done, short or not. Separate from
 *  `received`, which arrives with a bill: only a person can say that no more
 *  is coming. */
export async function closePurchaseOrder(id: string): Promise<PoResult> {
  try {
    if (!UUID.test(id)) throw new PoError('That order does not exist')
    await actor()
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    return await txn(async (tx) => {
      const [po] = await tx<{ id: string; status: string; doc_no: string | null }[]>`
        select id, status, doc_no from purchase_orders
        where id = ${id} and restaurant_id = ${rid}
        for update`
      if (!po) throw new PoError('That order does not exist')
      if (po.status === 'cancelled') throw new PoError('That order was cancelled')
      if (po.status === 'draft') throw new PoError('That order has not been sent yet')
      if (po.status === 'closed') throw new PoError('That order is already closed')
      await tx`update purchase_orders set status = 'closed'
               where id = ${id} and restaurant_id = ${rid}`
      return { ok: true as const, id, doc_no: po.doc_no }
    })
  } catch (e) {
    return fail(e)
  }
}
