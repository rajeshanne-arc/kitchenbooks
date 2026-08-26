// PURCHASE ORDERS — the read side, and the first document in this app that
// leaves the building.
//
// Everything before it pointed inward. An indent is kitchen-to-store; a bill
// records what a vendor already sent. Nothing said "please send us this".
// Petpooja can raise one, but only from Petpooja's inventory, which nobody
// here maintains — stock, reorder levels and vendor history all live in this
// database, so the order belongs where the stock is.
//
// TWO RULES THIS FILE EXISTS TO KEEP:
//
//   RATES ARE THE VENDOR'S OWN. `vendor_supplied_items.last_rate` is keyed on
//   (restaurant, vendor, item) and that is the whole point of the view: RR
//   Chicken bills boneless at ₹330 and Sneha at ₹300, measured. A purchase
//   order quoting a price the vendor never gave is worse than a blank one,
//   because a blank invites a question and a wrong number invites agreement.
//
//   THE GAP IS DELIVERED − ORDERED, so negative is short — the opposite of how
//   anybody says it out loud. Nothing here coalesces it and nothing renders it
//   as a signed number; `GapCell` says it in words, and it needs the STATUS to
//   know that an order nobody has delivered against yet is not short.

import 'server-only'
import { txn, tsql } from '@/lib/db'
import type {
  Letterhead,
  PoDraftLine,
  PoFulfilmentRow,
  PoLineRow,
  PurchaseOrderRow,
} from '@/lib/types'

/** Every order, newest first. `open` narrows to the two states that are still
 *  somebody's job — a draft nobody sent and an order nobody has delivered. */
export async function listPurchaseOrders(
  restaurantId: string,
  open = false,
): Promise<PurchaseOrderRow[]> {
  return tsql<PurchaseOrderRow[]>`
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
    where p.restaurant_id = ${restaurantId}
      and (${open} = false or p.status in ('draft', 'sent'))
    order by p.po_date desc, p.created_at desc`
}

export async function getPurchaseOrder(
  restaurantId: string,
  id: string,
): Promise<{ po: PurchaseOrderRow; lines: PoLineRow[]; fulfilment: PoFulfilmentRow[] } | null> {
  return txn(async (tx) => {
    const [po] = await tx<PurchaseOrderRow[]>`
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
      where p.restaurant_id = ${restaurantId} and p.id = ${id}`
    if (!po) return null

    const lines = await tx<PoLineRow[]>`
      select l.id, l.item_id, i.code as item_code, i.name as item_name, i.purchase_unit,
             l.qty::text as qty, l.rate::text as rate, l.amount::text as amount, l.note
      from purchase_order_lines l
      join items i on i.restaurant_id = l.restaurant_id and i.id = l.item_id
      where l.restaurant_id = ${restaurantId} and l.purchase_order_id = ${id}
      order by i.name asc`

    // po_fulfilment EXCLUDES cancelled orders by its own WHERE, so a cancelled
    // one returns nothing here and the page says so rather than printing a
    // table of shortfalls against an order nobody was ever going to fill.
    const fulfilment = await tx<PoFulfilmentRow[]>`
      select po_id, doc_no, status, item_code, item_name, purchase_unit,
             qty_ordered::text as qty_ordered, rate::text as rate,
             qty_delivered::text as qty_delivered, gap::text as gap
      from po_fulfilment
      where restaurant_id = ${restaurantId} and po_id = ${id}
      order by item_name asc`

    return { po, lines, fulfilment }
  })
}

/**
 * What to put on an order for ONE vendor, offered from two places that already
 * know: `reorder_due` for what the shelf is short of, and
 * `vendor_supplied_items` for what THIS vendor last charged for it.
 *
 * SCOPED, NOT EXCLUSIVE — the picker rule. The suggestion is every item at or
 * below its reorder level whose default vendor is this one; the order form
 * still lets any item be added, because a vendor can be asked for something
 * they have never sent and a first purchase has no history.
 */
export async function getReorderDraft(
  restaurantId: string,
  vendorId: string,
): Promise<PoDraftLine[]> {
  return tsql<PoDraftLine[]>`
    select r.item_id, r.code as item_code, r.name as item_name, r.purchase_unit,
           -- par − on hand, already computed by the view. Not rounded here:
           -- this is what the shelf says, and the rounding is a decision the
           -- person raising the order makes on the form.
           greatest(r.suggested_qty, 0)::text as suggested_qty,
           r.on_hand_qty::text as on_hand_qty,
           -- THEIRS. vendor_supplied_items keys on (restaurant, vendor, item)
           -- and skips voided bills; a NULL here means this vendor has never
           -- billed this item, and the form says so instead of borrowing
           -- somebody else's price.
           vsi.last_rate::text as last_rate,
           vsi.last_bought::text as last_bought
    from reorder_due r
    left join vendor_supplied_items vsi
      on vsi.restaurant_id = r.restaurant_id
     and vsi.vendor_id = ${vendorId}
     and vsi.item_id = r.item_id
    where r.restaurant_id = ${restaurantId} and r.vendor_id = ${vendorId}
    order by r.name asc`
}

/** This vendor's last rate for every item they have ever billed — for the form
 *  when somebody adds an item the reorder list did not suggest. */
export async function getVendorRates(
  restaurantId: string,
  vendorId: string,
): Promise<{ item_id: string; last_rate: string; last_bought: string }[]> {
  return tsql<{ item_id: string; last_rate: string; last_bought: string }[]>`
    select item_id, last_rate::text as last_rate, last_bought::text as last_bought
    from vendor_supplied_items
    where restaurant_id = ${restaurantId} and vendor_id = ${vendorId}`
}

/** Orders a delivery could be billed against: sent, or already part-received.
 *  A draft is excluded — nothing was asked for yet, so nothing can arrive
 *  against it. */
export async function listReceivablePos(
  restaurantId: string,
  vendorId: string,
): Promise<PurchaseOrderRow[]> {
  return tsql<PurchaseOrderRow[]>`
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
    where p.restaurant_id = ${restaurantId} and p.vendor_id = ${vendorId}
      and p.status in ('sent', 'received')
    order by p.po_date desc`
}

/** The lines of an order, for prefilling a bill against it. */
export async function getPoLinesForBill(
  restaurantId: string,
  poId: string,
): Promise<PoLineRow[]> {
  return tsql<PoLineRow[]>`
    select l.id, l.item_id, i.code as item_code, i.name as item_name, i.purchase_unit,
           l.qty::text as qty, l.rate::text as rate, l.amount::text as amount, l.note
    from purchase_order_lines l
    join items i on i.restaurant_id = l.restaurant_id and i.id = l.item_id
    where l.restaurant_id = ${restaurantId} and l.purchase_order_id = ${poId}
    order by i.name asc`
}

/** The restaurant as a vendor sees it. Every field is NULL on a new tenant and
 *  on Thrayam today — the document names what is missing rather than printing
 *  a heading from nobody. */
export async function getLetterhead(restaurantId: string): Promise<Letterhead> {
  const [row] = await tsql<Letterhead[]>`
    select name, legal_name, address_line1, address_line2, city, state, pincode,
           phone, email, gstin, fssai_number, logo_url
    from restaurants
    where id = ${restaurantId}`
  return row
}

/**
 * THE BLOCKER, COUNTED. Not one of the five active vendors has a phone number,
 * so not one purchase order can be sent. Surfaced on the vendor list, on the
 * order screen and in the store's readiness block — an order with nowhere to
 * go is a PDF, and that is a fact about the vendor master, not about the
 * order.
 */
export async function countVendorsWithoutPhone(
  restaurantId: string,
): Promise<{ without: number; total: number }> {
  const [row] = await tsql<{ without: number; total: number }[]>`
    select count(*) filter (where phone is null or btrim(phone) = '')::int as without,
           count(*)::int as total
    from vendors
    where restaurant_id = ${restaurantId} and status = 'active'`
  return { without: row?.without ?? 0, total: row?.total ?? 0 }
}

/** Vendors an order can be raised for, WITH the phone number that decides
 *  whether it can be sent. A dedicated query rather than widening `VendorHit`,
 *  which five other screens read and none of them needs a phone. */
export async function listVendorsForOrder(
  restaurantId: string,
): Promise<{ id: string; code: string; name: string; phone: string | null; due: number }[]> {
  return tsql<{ id: string; code: string; name: string; phone: string | null; due: number }[]>`
    select v.id, v.code, v.name,
           nullif(btrim(coalesce(v.phone, '')), '') as phone,
           -- how many of this vendor's items are at or below their reorder
           -- level, so the picker can lead with the ones there is a reason to
           -- order from
           (select count(*)::int from reorder_due r
             where r.restaurant_id = v.restaurant_id and r.vendor_id = v.id) as due
    from vendors v
    where v.restaurant_id = ${restaurantId} and v.status = 'active'
    order by due desc, v.name asc`
}
