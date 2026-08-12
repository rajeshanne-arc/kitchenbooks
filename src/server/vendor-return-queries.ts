// Read side of goods going BACK to the vendor, and the refusals the write
// side leans on.
//
// A vendor return is its own event, not a negative purchase: purchase_register
// stays a record of what was bought, and the return states separately what
// went back and what credit is claimed for it. Two views already read these
// rows and neither is recomputed here:
//
//   vendor_dues.credits      sum(vendor_return_lines.amount) per vendor,
//                            SUBTRACTED from the balance — a return reduces
//                            what we owe, so this is the payment queue's
//                            number, not a report's.
//   vendor_performance       returned_value beside the shorts.
//   stock_on_hand            subtracts sum(vendor_return_lines.qty).
//
// The waiting state is the one worth surfacing: goods gone, money not yet
// back. That is what listAwaitingCreditNote answers.

import 'server-only'
import { sql } from '@/lib/db'
import type { VendorReturnRow } from '@/lib/types'

/** A refusal that names the missing answer, so it reaches the user in its own
 *  words rather than wrapped in an apology. */
export class VendorReturnRefusal extends Error {}

/** One line of a return, as it is read back. `amount` is GENERATED (qty × rate)
 *  and is therefore never written — only read. */
export type VendorReturnLineRow = {
  id: string
  item_id: string
  item_code: string
  item_name: string
  purchase_unit: string
  qty: string
  rate: string
  amount: string
}

/** A bill the credit could be set against. The credit usually lands on a LATER
 *  bill, which is why settled_against_purchase_id stays empty until it does. */
export type CreditBillOption = {
  vendor_id: string
  id: string
  doc_no: string | null
  bill_no: string | null
  bill_date: string
  bill_total: string
}

const RETURN_SELECT = `
  select r.id, r.return_date::text as return_date, r.vendor_id, v.name as vendor_name,
         r.reason, r.credit_note_ref, r.settled_against_purchase_id, r.note, r.entered_by,
         (r.reverses_id is not null) as is_reversal,
         exists (select 1 from vendor_returns x where x.reverses_id = r.id) as is_voided,
         (select count(*)::int from vendor_return_lines l where l.vendor_return_id = r.id) as line_count,
         coalesce((select sum(l.amount) from vendor_return_lines l where l.vendor_return_id = r.id), 0)::text as total
  from vendor_returns r
  join vendors v on v.id = r.vendor_id`

export async function getVendorReturn(restaurantId: string, id: string): Promise<VendorReturnRow | null> {
  const rows = await sql<VendorReturnRow[]>`
    ${sql.unsafe(RETURN_SELECT)}
    where r.restaurant_id = ${restaurantId} and r.id = ${id}`
  return rows[0] ?? null
}

export async function listVendorReturns(restaurantId: string, limit = 40): Promise<VendorReturnRow[]> {
  return sql<VendorReturnRow[]>`
    ${sql.unsafe(RETURN_SELECT)}
    where r.restaurant_id = ${restaurantId}
    order by r.return_date desc, r.created_at desc
    limit ${limit}`
}

/** Goods gone, money not yet back. Reversals are excluded (they claim nothing)
 *  and so are voided returns (the claim was withdrawn). */
export async function listAwaitingCreditNote(restaurantId: string): Promise<VendorReturnRow[]> {
  return sql<VendorReturnRow[]>`
    ${sql.unsafe(RETURN_SELECT)}
    where r.restaurant_id = ${restaurantId}
      and r.credit_note_ref is null
      and r.reverses_id is null
      and not exists (select 1 from vendor_returns x where x.reverses_id = r.id)
    order by r.return_date asc, r.created_at asc`
}

/** How many live returns have their credit note, out of how many exist — the
 *  honesty meter's two numbers, counted rather than estimated. */
export async function creditNoteProgress(
  restaurantId: string,
): Promise<{ settled: number; total: number; owed: string }> {
  const [row] = await sql<{ settled: number; total: number; owed: string }[]>`
    select count(*) filter (where r.credit_note_ref is not null)::int as settled,
           count(*)::int as total,
           coalesce(sum(
             case when r.credit_note_ref is null
                  then (select coalesce(sum(l.amount), 0) from vendor_return_lines l
                        where l.vendor_return_id = r.id)
                  else 0 end
           ), 0)::text as owed
    from vendor_returns r
    where r.restaurant_id = ${restaurantId}
      and r.reverses_id is null
      and not exists (select 1 from vendor_returns x where x.reverses_id = r.id)`
  return row ?? { settled: 0, total: 0, owed: '0' }
}

export async function getVendorReturnLines(vendorReturnId: string): Promise<VendorReturnLineRow[]> {
  return sql<VendorReturnLineRow[]>`
    select l.id, l.item_id, i.code as item_code, i.name as item_name, i.purchase_unit,
           l.qty::text as qty, l.rate::text as rate, l.amount::text as amount
    from vendor_return_lines l
    join items i on i.id = l.item_id
    where l.vendor_return_id = ${vendorReturnId}
    order by i.code asc, l.id asc`
}

/**
 * Recent bills for the vendors that have a return awaiting a credit note, in
 * ONE query. Fetching them per row would put a round trip behind every open
 * disclosure, and the pool is shared with the layout above this page.
 *
 * Reversal bills are excluded — a voided bill is not something a credit can
 * come off. The per-vendor cap is applied after the read rather than in a
 * window function, so the statement stays one plain SELECT over one relation.
 */
export async function listCreditBillOptions(
  restaurantId: string,
  vendorIds: string[],
  perVendor = 8,
): Promise<CreditBillOption[]> {
  if (vendorIds.length === 0) return []
  const rows = await sql<CreditBillOption[]>`
    select p.vendor_id, p.id, p.doc_no, p.bill_no,
           p.bill_date::text as bill_date, p.bill_total::text as bill_total
    from purchases p
    where p.restaurant_id = ${restaurantId}
      and p.vendor_id = any(${vendorIds})
      and p.reverses_id is null
    order by p.vendor_id, p.bill_date desc, p.created_at desc
    limit 400`
  const seen = new Map<string, number>()
  return rows.filter((r) => {
    const n = (seen.get(r.vendor_id) ?? 0) + 1
    seen.set(r.vendor_id, n)
    return n <= perVendor
  })
}

/* ── refusals ───────────────────────────────────────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Goods can only go back to a vendor already on file — a return cannot invent
 *  one, the way a bill can. The refusal names where vendors are born.
 *
 *  A retired vendor is NOT refused: they can have sent bad goods the week
 *  before they were retired, and retire-never-delete means the row is still
 *  the right one to credit against.
 *
 *  The shape is checked before the query because a server action is a public
 *  endpoint: an id that is not a uuid would otherwise reach Postgres and come
 *  back as a syntax error in the user's face instead of this sentence. */
export async function assertVendor(restaurantId: string, vendorId: string): Promise<{ id: string; name: string }> {
  const rows: { id: string; name: string }[] = UUID.test(vendorId)
    ? await sql<{ id: string; name: string }[]>`
        select id, name from vendors where id = ${vendorId} and restaurant_id = ${restaurantId}`
    : []
  const vendor = rows[0]
  if (!vendor) {
    throw new VendorReturnRefusal(
      'Pick the vendor the goods are going back to — a return cannot invent one. Add them under Masters → Vendors first.',
    )
  }
  return { id: vendor.id, name: vendor.name }
}

/** Every item on the return must belong to this restaurant. Returns the ids
 *  that did not, so the refusal can count them instead of waving vaguely. */
export async function assertItems(restaurantId: string, itemIds: string[]): Promise<void> {
  const found = await sql<{ id: string }[]>`
    select id from items where restaurant_id = ${restaurantId} and id = any(${itemIds})`
  const known = new Set(found.map((r) => r.id))
  const missing = itemIds.filter((id) => !known.has(id))
  if (missing.length > 0) {
    throw new VendorReturnRefusal(
      `${missing.length} ${missing.length === 1 ? 'line names an item' : 'lines name items'} this restaurant does not have — reload the page and pick them again.`,
    )
  }
}

/** A credit can only be set against a bill from the SAME vendor. Setting it
 *  against somebody else's bill would net one vendor's credit off another's
 *  balance, and vendor_dues would show both wrong with nothing saying so. */
export async function assertPurchaseForVendor(
  restaurantId: string,
  vendorId: string,
  purchaseId: string,
): Promise<string> {
  const rows = await sql<{ id: string; vendor_id: string }[]>`
    select id, vendor_id from purchases where id = ${purchaseId} and restaurant_id = ${restaurantId}`
  const purchase = rows[0]
  if (!purchase) throw new VendorReturnRefusal('That bill is not on file — reload and pick it again')
  if (purchase.vendor_id !== vendorId) {
    throw new VendorReturnRefusal('That bill belongs to a different vendor — a credit only settles against its own vendor’s bill')
  }
  return purchase.id
}
