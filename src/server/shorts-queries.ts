// Read side of shorts and vendor performance, plus the refusals both the
// actions and the screens lean on.
//
// SHORT OR DAMAGED ON RECEIPT is the most common daily store event and was
// entirely unmodelled: the vendor bills 10 kg, delivers 8, the receiver
// enters 8, and the two kilos vanish from the record. `purchase_lines.qty`
// STILL MEANS WHAT ARRIVED — stock, costs and COGS all stay correct — so the
// short is recorded BESIDE the line, in its own table, and nothing
// downstream shifts.
//
// Every figure here is worked out by Postgres in numeric: qty × rate is
// never multiplied in JavaScript, so a row agrees with vendor_performance
// (which sums the same product) to the paisa.

import 'server-only'
import { sql } from '@/lib/db'
import { getSessionUser } from '@/server/current-user'
import type { ShortKind, ShortSettlement, VendorPerformanceRow } from '@/lib/types'
import { SHORT_KINDS, SHORT_SETTLEMENTS, type ValuedShort } from '@/components/store/shorts'
import type { Role } from '@/lib/roles'

export class ShortsError extends Error {}

/** goods in and what they were billed at is the store's desk */
const STORE_DESK: Role[] = ['store', 'manager', 'owner']

/** Who is asking, checked against the DATABASE every time — a server action
 *  is a public endpoint, and the route gate is not the check. */
export async function shortsActor(what: string): Promise<string> {
  const user = await getSessionUser()
  if (!user) throw new ShortsError('Sign in again — the session has expired')
  if (!STORE_DESK.includes(user.role)) {
    throw new ShortsError(`${what} belongs to the store — ask them, or a manager`)
  }
  return user.username
}

export function isShortKind(v: string): v is ShortKind {
  return (SHORT_KINDS as readonly string[]).includes(v)
}

export function isShortSettlement(v: string): v is ShortSettlement {
  return (SHORT_SETTLEMENTS as readonly string[]).includes(v)
}

/* ── shorts ─────────────────────────────────────────────────────────────── */

/** OPEN FIRST, always. A short nobody chased is a different fact from one
 *  that was credited, and it is the only one still worth money. */
export async function listShorts(restaurantId: string, limit = 300): Promise<ValuedShort[]> {
  return sql<ValuedShort[]>`
    select s.id, s.purchase_line_id, pl.purchase_id, p.bill_date::text as bill_date, p.doc_no,
           p.vendor_id, v.name as vendor_name,
           i.code as item_code, i.name as item_name, i.purchase_unit,
           pl.qty::text as qty_received, s.qty_short::text as qty_short, pl.rate::text as rate,
           (pl.qty + s.qty_short)::text as qty_billed,
           (s.qty_short * pl.rate)::text as short_value,
           s.kind, s.settlement, s.credit_note_ref, s.note, s.entered_by
    from purchase_line_shorts s
    join purchase_lines pl on pl.id = s.purchase_line_id
    join purchases p on p.id = pl.purchase_id
    join vendors v on v.id = p.vendor_id
    join items i on i.id = pl.item_id
    where s.restaurant_id = ${restaurantId}
    order by (s.settlement = 'open') desc, p.bill_date desc, s.created_at desc
    limit ${limit}`
}

export async function listShortsForPurchase(restaurantId: string, purchaseId: string): Promise<ValuedShort[]> {
  return sql<ValuedShort[]>`
    select s.id, s.purchase_line_id, pl.purchase_id, p.bill_date::text as bill_date, p.doc_no,
           p.vendor_id, v.name as vendor_name,
           i.code as item_code, i.name as item_name, i.purchase_unit,
           pl.qty::text as qty_received, s.qty_short::text as qty_short, pl.rate::text as rate,
           (pl.qty + s.qty_short)::text as qty_billed,
           (s.qty_short * pl.rate)::text as short_value,
           s.kind, s.settlement, s.credit_note_ref, s.note, s.entered_by
    from purchase_line_shorts s
    join purchase_lines pl on pl.id = s.purchase_line_id
    join purchases p on p.id = pl.purchase_id
    join vendors v on v.id = p.vendor_id
    join items i on i.id = pl.item_id
    where s.restaurant_id = ${restaurantId} and pl.purchase_id = ${purchaseId}
    order by i.code asc, s.created_at asc`
}

/** the read-back: nothing is reported saved that cannot be read again */
export async function getShort(restaurantId: string, id: string): Promise<ValuedShort | null> {
  const rows = await sql<ValuedShort[]>`
    select s.id, s.purchase_line_id, pl.purchase_id, p.bill_date::text as bill_date, p.doc_no,
           p.vendor_id, v.name as vendor_name,
           i.code as item_code, i.name as item_name, i.purchase_unit,
           pl.qty::text as qty_received, s.qty_short::text as qty_short, pl.rate::text as rate,
           (pl.qty + s.qty_short)::text as qty_billed,
           (s.qty_short * pl.rate)::text as short_value,
           s.kind, s.settlement, s.credit_note_ref, s.note, s.entered_by
    from purchase_line_shorts s
    join purchase_lines pl on pl.id = s.purchase_line_id
    join purchases p on p.id = pl.purchase_id
    join vendors v on v.id = p.vendor_id
    join items i on i.id = pl.item_id
    where s.restaurant_id = ${restaurantId} and s.id = ${id}`
  return rows[0] ?? null
}

export type ShortTotals = {
  open_count: number
  open_value: string
  settled_count: number
  settled_value: string
}

/** Summed in Postgres numeric rather than by adding rounded paise on the
 *  page — the same product vendor_performance sums, added the same way. */
export async function getShortTotals(restaurantId: string): Promise<ShortTotals> {
  const rows = await sql<ShortTotals[]>`
    select count(*) filter (where s.settlement = 'open')::int as open_count,
           coalesce(sum(s.qty_short * pl.rate) filter (where s.settlement = 'open'), 0)::text as open_value,
           count(*) filter (where s.settlement <> 'open')::int as settled_count,
           coalesce(sum(s.qty_short * pl.rate) filter (where s.settlement <> 'open'), 0)::text as settled_value
    from purchase_line_shorts s
    join purchase_lines pl on pl.id = s.purchase_line_id
    where s.restaurant_id = ${restaurantId}`
  return rows[0] ?? { open_count: 0, open_value: '0', settled_count: 0, settled_value: '0' }
}

/* ── vendor performance ─────────────────────────────────────────────────── */

/** vendor_performance, verbatim. THE VIEW OWNS EVERY FIGURE — the order is
 *  the only thing decided here, and it puts the money still owed on top. */
export async function listVendorPerformance(restaurantId: string): Promise<VendorPerformanceRow[]> {
  return sql<VendorPerformanceRow[]>`
    select vp.vendor_id, vp.code, vp.name,
           vp.bills::int as bills, vp.short_events::int as short_events,
           vp.short_value::text as short_value, vp.unsettled::int as unsettled,
           vp.returned_value::text as returned_value
    from vendor_performance vp
    where vp.restaurant_id = ${restaurantId}
    order by vp.unsettled desc, vp.short_value desc, vp.bills desc, vp.name asc`
}
