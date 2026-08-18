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
import { sql, tsql } from '@/lib/db'
import type {
  BillReturnPrefill,
  IssuableItemHit,
  ItemSuggestion,
  ReturnableBillRow,
  VendorReturnReasonRow,
  VendorReturnRow,
} from '@/lib/types'

/** A refusal that names the missing answer, so it reaches the user in its own
 *  words rather than wrapped in an apology. */
export class VendorReturnRefusal extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  /** per line — a rotten crate and a wrong item go back on the same trip */
  reason: string | null
  /** the bill line these goods arrived on, when the return was opened from a
   *  bill. It is what gives the rate a provenance. */
  source_purchase_line_id: string | null
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
         -- COMPUTED, NEVER CACHED. One distinct reason names itself; several
         -- read "Mixed". A predominant reason stored on the header could
         -- disagree with the lines it claims to summarise, and nothing on
         -- screen would look wrong. coalesce falls back to the header only
         -- for rows written before reasons moved to the line.
         coalesce(
           (select case when count(distinct l.reason) = 1 then min(l.reason)
                        when count(distinct l.reason) > 1 then 'Mixed'
                   end
            from vendor_return_lines l
            where l.vendor_return_id = r.id and l.reason is not null),
           r.reason
         ) as reason,
         r.credit_note_ref, r.settled_against_purchase_id, r.note, r.entered_by,
         (r.reverses_id is not null) as is_reversal,
         exists (select 1 from vendor_returns x where x.reverses_id = r.id) as is_voided,
         (select count(*)::int from vendor_return_lines l where l.vendor_return_id = r.id) as line_count,
         coalesce((select sum(l.amount) from vendor_return_lines l where l.vendor_return_id = r.id), 0)::text as total
  from vendor_returns r
  join vendors v on v.id = r.vendor_id`

export async function getVendorReturn(restaurantId: string, id: string): Promise<VendorReturnRow | null> {
  const rows = await tsql<VendorReturnRow[]>`
    ${sql.unsafe(RETURN_SELECT)}
    where r.restaurant_id = ${restaurantId} and r.id = ${id}`
  return rows[0] ?? null
}

export async function listVendorReturns(restaurantId: string, limit = 40): Promise<VendorReturnRow[]> {
  return tsql<VendorReturnRow[]>`
    ${sql.unsafe(RETURN_SELECT)}
    where r.restaurant_id = ${restaurantId}
    order by r.return_date desc, r.created_at desc
    limit ${limit}`
}

/** Goods gone, money not yet back. Reversals are excluded (they claim nothing)
 *  and so are voided returns (the claim was withdrawn). */
export async function listAwaitingCreditNote(restaurantId: string): Promise<VendorReturnRow[]> {
  return tsql<VendorReturnRow[]>`
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
  const [row] = await tsql<{ settled: number; total: number; owed: string }[]>`
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
  return tsql<VendorReturnLineRow[]>`
    select l.id, l.item_id, i.code as item_code, i.name as item_name, i.purchase_unit,
           l.qty::text as qty, l.rate::text as rate, l.amount::text as amount,
           l.reason, l.source_purchase_line_id
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
  const rows = await tsql<CreditBillOption[]>`
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

/**
 * Why goods came back from one vendor, worst habit first.
 *
 * RANKED BY COUNT, not by value, and that is the argument: a rupee total is
 * already on `vendor_performance`, and it cannot tell four rotten crates from
 * one expensive mis-delivery. The repeated fault is the one that decides
 * whether to keep buying from somebody.
 *
 * The view already filters reversed pairs, so a voided return does not count
 * against a supplier — which is the whole reason the void could come back.
 */
export async function getVendorReturnReasons(
  restaurantId: string,
  vendorId: string,
): Promise<VendorReturnReasonRow[]> {
  if (!UUID.test(vendorId)) return []
  return tsql<VendorReturnReasonRow[]>`
    select vendor_id, vendor_name, reason,
           lines::int as lines,
           value::text as value,
           last_returned::text as last_returned
    from vendor_return_reasons
    where restaurant_id = ${restaurantId} and vendor_id = ${vendorId}
    order by lines desc, value desc, reason asc`
}

/* ── pickers, scoped by what is already known ───────────────────────────── */

/**
 * What this vendor has actually supplied — the picker once the vendor is known.
 *
 * The blank form asked the store manager to type a rate and said, on screen,
 * "normally the rate on the bill these arrived on". That is asking somebody to
 * remember a number the database is holding. `vendor_supplied_items` carries
 * `last_rate` and the LINE it came from, so the rate arrives with a provenance
 * instead of a memory.
 *
 * RANKED MOST RECENT FIRST, and this deliberately differs from the frequency-
 * first rule everywhere else. At the moment of a return the delivery being
 * argued about is the one that just came through the door; how often this
 * vendor has ever sent that item is the weaker signal. Frequency breaks the
 * tie.
 *
 * IT SCOPES WITHOUT EXCLUDING. A vendor can send something they have never
 * sent before — that is half of why goods go back — so the general search
 * stays underneath and reaches every item.
 */
export async function getVendorSuppliedItems(
  restaurantId: string,
  vendorId: string,
): Promise<ItemSuggestion[]> {
  if (!UUID.test(vendorId)) return []
  const rows = await tsql<
    {
      id: string
      code: string
      name: string
      category_name: string
      purchase_unit: string
      unit_name: string
      on_hand_qty: string
      has_cost: boolean
      times: number
      last: string
      last_rate: string | null
      source_purchase_line_id: string | null
    }[]
  >`
    select v.item_id as id, v.item_code as code, v.item_name as name,
           c.name as category_name, v.purchase_unit, u.name as unit_name,
           coalesce(s.on_hand_qty, 0)::text as on_hand_qty,
           (ic.issue_cost is not null) as has_cost,
           v.times_bought::int as times,
           v.last_bought::text as last,
           v.last_rate::text as last_rate,
           v.last_purchase_line_id as source_purchase_line_id
    from vendor_supplied_items v
    join items i on i.id = v.item_id
    join categories c on c.code = i.category
    join units u on u.code = v.purchase_unit
    left join stock_on_hand s on s.item_id = v.item_id
    left join item_costs ic on ic.item_id = v.item_id
    where v.restaurant_id = ${restaurantId}
      and v.vendor_id = ${vendorId}
      and i.status = 'active'
    order by v.last_bought desc, v.times_bought desc, v.item_name asc
    limit 30`
  return rows.map((r) => ({
    item: {
      id: r.id,
      code: r.code,
      name: r.name,
      category_name: r.category_name,
      purchase_unit: r.purchase_unit,
      unit_name: r.unit_name,
      on_hand_qty: r.on_hand_qty,
      has_cost: r.has_cost,
    },
    times: r.times,
    last: r.last,
    typical_qty: null,
    last_rate: r.last_rate,
    source_purchase_line_id: r.source_purchase_line_id,
  }))
}

/**
 * Bills a return could be opened FROM, newest first.
 *
 * A reversal is excluded and so is a bill that has been voided — there is
 * nothing left on either for a vendor to credit, which is the same test
 * `saveShorts` applies to its header.
 */
export async function listReturnableBills(
  restaurantId: string,
  limit = 25,
): Promise<ReturnableBillRow[]> {
  return tsql<ReturnableBillRow[]>`
    select p.id, p.doc_no, p.bill_no, p.bill_date::text as bill_date,
           p.vendor_id, v.name as vendor_name, p.bill_total::text as bill_total,
           (select count(*)::int from purchase_lines l where l.purchase_id = p.id) as line_count
    from purchases p
    join vendors v on v.id = p.vendor_id
    where p.restaurant_id = ${restaurantId}
      and p.reverses_id is null
      and not exists (select 1 from purchases x where x.reverses_id = p.id)
    order by p.bill_date desc, p.created_at desc
    limit ${limit}`
}

/**
 * One bill, opened as a return — the shorts pattern, applied to the other
 * direction. Picking the bill answers the vendor, the items AND the rate at
 * once; the receiver holding a bad crate is holding the bill too.
 *
 * QUANTITIES ARE NOT PREFILLED. What arrived is not what is going back, and a
 * quantity nobody counted looks exactly like one somebody did.
 */
export async function getBillReturnPrefill(
  restaurantId: string,
  purchaseId: string,
): Promise<BillReturnPrefill | null> {
  if (!UUID.test(purchaseId)) return null
  const [bill] = await tsql<
    {
      purchase_id: string
      vendor_id: string
      vendor_name: string
      bill_no: string | null
      doc_no: string | null
      bill_date: string
      is_dead: boolean
    }[]
  >`
    select p.id as purchase_id, p.vendor_id, v.name as vendor_name,
           p.bill_no, p.doc_no, p.bill_date::text as bill_date,
           (p.reverses_id is not null
            or exists (select 1 from purchases x where x.reverses_id = p.id)) as is_dead
    from purchases p
    join vendors v on v.id = p.vendor_id
    where p.id = ${purchaseId} and p.restaurant_id = ${restaurantId}`
  if (!bill || bill.is_dead) return null

  const lines = await tsql<
    {
      purchase_line_id: string
      rate: string
      billed_qty: string
      id: string
      code: string
      name: string
      category_name: string
      purchase_unit: string
      unit_name: string
      on_hand_qty: string
      has_cost: boolean
    }[]
  >`
    select l.id as purchase_line_id, l.rate::text as rate, l.qty::text as billed_qty,
           i.id, i.code, i.name, c.name as category_name,
           i.purchase_unit, u.name as unit_name,
           coalesce(s.on_hand_qty, 0)::text as on_hand_qty,
           (ic.issue_cost is not null) as has_cost
    from purchase_lines l
    join items i on i.id = l.item_id
    join categories c on c.code = i.category
    join units u on u.code = i.purchase_unit
    left join stock_on_hand s on s.item_id = i.id
    left join item_costs ic on ic.item_id = i.id
    where l.purchase_id = ${purchaseId} and l.restaurant_id = ${restaurantId}
    order by i.code asc, l.id asc`

  return {
    purchase_id: bill.purchase_id,
    vendor_id: bill.vendor_id,
    vendor_name: bill.vendor_name,
    bill_no: bill.bill_no,
    doc_no: bill.doc_no,
    bill_date: bill.bill_date,
    lines: lines.map((l) => ({
      item: {
        id: l.id,
        code: l.code,
        name: l.name,
        category_name: l.category_name,
        purchase_unit: l.purchase_unit,
        unit_name: l.unit_name,
        on_hand_qty: l.on_hand_qty,
        has_cost: l.has_cost,
      } satisfies IssuableItemHit,
      rate: l.rate,
      billed_qty: l.billed_qty,
      purchase_line_id: l.purchase_line_id,
    })),
  }
}

/* ── refusals ───────────────────────────────────────────────────────────── */

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
    ? await tsql<{ id: string; name: string }[]>`
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
  const found = await tsql<{ id: string }[]>`
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
  const rows = await tsql<{ id: string; vendor_id: string }[]>`
    select id, vendor_id from purchases where id = ${purchaseId} and restaurant_id = ${restaurantId}`
  const purchase = rows[0]
  if (!purchase) throw new VendorReturnRefusal('That bill is not on file — reload and pick it again')
  if (purchase.vendor_id !== vendorId) {
    throw new VendorReturnRefusal('That bill belongs to a different vendor — a credit only settles against its own vendor’s bill')
  }
  return purchase.id
}


/**
 * The provenance of a claimed rate: the bill line the goods arrived on.
 *
 * THE PICKER IS NOT THE CHECK. The form only ever offers lines from this
 * vendor's own bills, but a server action is a public endpoint, and a line id
 * pointing at somebody else's bill would put a false provenance on the claim —
 * a number that looks sourced and is not. Blank is allowed: a return can be
 * opened without naming where the goods came from.
 */
export async function assertSourceLine(
  restaurantId: string,
  vendorId: string,
  purchaseLineId: string,
): Promise<string | null> {
  if (purchaseLineId === '') return null
  if (!UUID.test(purchaseLineId)) throw new VendorReturnRefusal('Malformed bill line id')
  const rows = await tsql<{ id: string }[]>`
    select l.id
    from purchase_lines l
    join purchases p on p.id = l.purchase_id
    where l.id = ${purchaseLineId}
      and l.restaurant_id = ${restaurantId}
      and p.vendor_id = ${vendorId}`
  if (!rows[0]) {
    throw new VendorReturnRefusal(
      'That bill line is not one of this vendor’s — reload the page and pick the bill again',
    )
  }
  return rows[0].id
}
