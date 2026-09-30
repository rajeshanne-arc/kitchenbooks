'use server'

import { z } from 'zod'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { txn, tsql } from '@/lib/db'
import { parseMoney, parseQty } from '@/lib/money'
import { nextDocNo } from '@/server/doc-numbers'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
class QuoteError extends Error {}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof QuoteError ? e.message : e instanceof z.ZodError ? 'Invalid quote — nothing was saved' : 'The quote could not be saved' })
function assertDate(value: string, label: string) {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!DATE.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new QuoteError(`${label} is not a real calendar date`)
}

async function actor() {
  const user = await getSessionUser()
  if (!user || !['store', 'manager', 'owner'].includes(user.role)) throw new QuoteError('Only the store, a manager or an owner can record quotations')
  return user
}

const Schema = z.object({
  vendorId: z.string().regex(UUID), quoteDate: z.string().regex(DATE), validUntil: z.union([z.literal(''), z.string().regex(DATE)]),
  reference: z.string().trim().max(100), note: z.string().trim().max(500),
  lines: z.array(z.object({ itemId: z.string().regex(UUID), qty: z.string().trim(), rate: z.string().trim(), note: z.string().trim().max(200) })).min(1).max(200),
})

export async function createPurchaseQuote(raw: z.infer<typeof Schema>): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const input = Schema.parse(raw); assertDate(input.quoteDate, 'Quote date'); if (input.validUntil !== '') { assertDate(input.validUntil, 'Valid until'); if (input.validUntil < input.quoteDate) throw new QuoteError('Valid until cannot be before the quote date') }
    const user = await actor(); const restaurant = await getRestaurant(); const rid = restaurant.id
    const lines = input.lines.map((line, i) => {
      const qty = parseQty(line.qty); const rate = parseMoney(line.rate)
      if (qty === null || qty <= 0) throw new QuoteError(`Line ${i + 1}: quantity must be more than zero`)
      if (rate === null || rate < 0) throw new QuoteError(`Line ${i + 1}: rate is not a valid amount`)
      return { ...line, qty: line.qty.trim(), rate: (rate / 100).toFixed(2) }
    })
    const id = await txn(async (tx) => {
      const [vendor] = await tx<{ id: string }[]>`select id from vendors where id = ${input.vendorId} and restaurant_id = ${rid} and status = 'active'`
      if (!vendor) throw new QuoteError('Choose an active vendor from this restaurant')
      const ids = lines.map((l) => l.itemId)
      const items = await tx<{ id: string }[]>`select id from items where restaurant_id = ${rid} and id = any(${ids}::uuid[]) and status = 'active'`
      if (items.length !== new Set(ids).size) throw new QuoteError('Every quote line must name one active item from this restaurant')
      const [quote] = await tx<{ id: string }[]>`insert into purchase_quotes (restaurant_id, vendor_id, quote_date, valid_until, reference, note, entered_by) values (${rid}, ${input.vendorId}, ${input.quoteDate}::date, ${input.validUntil === '' ? null : input.validUntil}::date, ${input.reference === '' ? null : input.reference}, ${input.note === '' ? null : input.note}, ${user.username}) returning id`
      await tx`insert into purchase_quote_lines ${tx(lines.map((l) => ({ restaurant_id: rid, quote_id: quote.id, item_id: l.itemId, qty: l.qty, rate: l.rate, note: l.note === '' ? null : l.note })), 'restaurant_id', 'quote_id', 'item_id', 'qty', 'rate', 'note')}`
      return quote.id
    })
    return { ok: true, id }
  } catch (e) { return fail(e) }
}

export async function decidePurchaseQuote(id: string, decision: 'accepted' | 'rejected'): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!UUID.test(id)) throw new QuoteError('That quote does not exist')
    const user = await getSessionUser(); if (!user || !['manager', 'owner'].includes(user.role)) throw new QuoteError('Only a manager or owner can decide a quotation')
    const rid = (await getRestaurant()).id
    const [row] = await tsql<{ id: string }[]>`update purchase_quotes set status = ${decision}, decided_by = ${user.username}, decided_at = now() where id = ${id} and restaurant_id = ${rid} and status = 'draft' and (valid_until is null or valid_until >= current_date) returning id`
    if (!row) throw new QuoteError('That quote is no longer awaiting a decision')
    return { ok: true }
  } catch (e) { return fail(e) }
}

/** Convert only an accepted quotation into a DRAFT PO. The quote remains
 * immutable evidence; the normal PO approval and vendor-send controls still
 * apply to the new document. */
export async function createPurchaseOrderFromQuote(id: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    if (!UUID.test(id)) throw new QuoteError('That quote does not exist')
    const user = await actor(); const rid = (await getRestaurant()).id
    const poId = await txn(async (tx) => {
      const [quote] = await tx<{ vendor_id: string; quote_date: string; valid_until: string | null; status: string; reference: string | null }[]>`select vendor_id, quote_date::text as quote_date, valid_until::text as valid_until, status, reference from purchase_quotes where id = ${id} and restaurant_id = ${rid} for update`
      if (!quote) throw new QuoteError('That quote does not exist')
      if (quote.status !== 'accepted') throw new QuoteError('Only an accepted quote can become a purchase order')
      if (quote.valid_until !== null && quote.valid_until < new Date().toISOString().slice(0, 10)) throw new QuoteError('That quote has expired — request a fresh quote')
      const lines = await tx<{ item_id: string; qty: string; rate: string; note: string | null }[]>`select item_id, qty::text as qty, rate::text as rate, note from purchase_quote_lines where restaurant_id = ${rid} and quote_id = ${id} order by id`
      if (lines.length === 0) throw new QuoteError('That quote has no lines')
      const docNo = await nextDocNo(tx, rid, 'PO', quote.quote_date)
      const [po] = await tx<{ id: string }[]>`insert into purchase_orders (restaurant_id, doc_no, vendor_id, po_date, status, note, entered_by) values (${rid}, ${docNo}, ${quote.vendor_id}, ${quote.quote_date}::date, 'draft', ${`From quotation${quote.reference ? ` ${quote.reference}` : ''}`}, ${user.username}) returning id`
      await tx`insert into purchase_order_lines ${tx(lines.map((line) => ({ restaurant_id: rid, purchase_order_id: po.id, item_id: line.item_id, qty: line.qty, rate: line.rate, note: line.note })), 'restaurant_id', 'purchase_order_id', 'item_id', 'qty', 'rate', 'note')}`
      return po.id
    })
    return { ok: true, id: poId }
  } catch (e) { return fail(e) }
}
