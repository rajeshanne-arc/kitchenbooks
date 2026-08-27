// Read side of Books. Derived numbers always come from the named views:
// bills (totals, line_count, is_voided/is_reversal), vendor_dues (balances),
// item_rates (prefill), item_purchase_history (history). Raw event columns
// (e.g. purchases.reverses_id for linking) may be read directly — they are
// facts, not recomputations.
import 'server-only'
import { sql, tsql } from '@/lib/db'
import type {
  BillLine,
  BillRow,
  DuesSnap,
  ItemDetail,
  ItemHistoryRow,
  ItemListRow,
  PaymentRow,
  VendorDetail,
  VendorDueRow,
  VendorHit,
  VendorListRow,
} from '@/lib/types'

const BILL_SELECT = `
  select b.id, b.bill_date::text as bill_date, b.bill_no,
         b.vendor_id, b.vendor_code, b.vendor_name,
         b.goods_total::text as goods_total, b.gst_total::text as gst_total,
         b.transport::text as transport, b.bill_total::text as bill_total,
         b.line_count::int as line_count, b.is_reversal, b.is_voided,
         b.entered_by, b.created_at::text as created_at, p.reverses_id, p.doc_no
  from bills b
  join purchases p on p.id = b.id`

export async function listBills(restaurantId: string, limit = 300): Promise<BillRow[]> {
  return tsql<BillRow[]>`
    ${sql.unsafe(BILL_SELECT)}
    where b.restaurant_id = ${restaurantId}
    order by b.bill_date desc, b.created_at desc
    limit ${limit}`
}

export async function getBill(restaurantId: string, id: string): Promise<BillRow | null> {
  const rows = await tsql<BillRow[]>`
    ${sql.unsafe(BILL_SELECT)}
    where b.restaurant_id = ${restaurantId} and b.id = ${id}`
  return rows[0] ?? null
}

export async function getBillLines(purchaseId: string): Promise<BillLine[]> {
  return tsql<BillLine[]>`
    select pl.id, pl.item_id, i.code as item_code, i.name as item_name, i.purchase_unit,
           pl.qty::text as qty, pl.rate::text as rate, pl.amount::text as amount,
           pl.gst_amount::text as gst_amount, pl.transport_alloc::text as transport_alloc,
           pl.landed::text as landed
    from purchase_lines pl
    join items i on i.id = pl.item_id
    where pl.purchase_id = ${purchaseId}
    order by i.code asc, pl.id asc`
}

/** The reversal bill that voids this one, if any */
export async function getVoidedBy(purchaseId: string): Promise<{ id: string; bill_no: string | null } | null> {
  const rows = await tsql<{ id: string; bill_no: string | null }[]>`
    select id, bill_no from purchases where reverses_id = ${purchaseId} limit 1`
  return rows[0] ?? null
}

export async function getVendorBills(restaurantId: string, vendorId: string): Promise<BillRow[]> {
  return tsql<BillRow[]>`
    ${sql.unsafe(BILL_SELECT)}
    where b.restaurant_id = ${restaurantId} and b.vendor_id = ${vendorId}
    order by b.bill_date desc, b.created_at desc
    limit 200`
}

/** Active vendors for the usual-supplier picker on an item. */
export async function listActiveVendors(restaurantId: string): Promise<VendorHit[]> {
  return tsql<VendorHit[]>`
    select v.id, v.code, v.name, v.primary_category, c.name as category_name,
           coalesce(d.balance, 0)::text as balance
    from vendors v
    join categories c on c.code = v.primary_category
    left join vendor_dues d on d.vendor_id = v.id
    where v.restaurant_id = ${restaurantId} and v.status = 'active'
    order by v.name asc`
}

/** Vendors carrying a balance, worst first — the payment queue.
 *
 * days_since_payment is null when they have never been paid: that is a
 * different fact from "paid a long time ago" and the screen says so. */
export async function listVendorsWithDues(
  restaurantId: string,
  filter: 'owed' | 'settled' | 'all' = 'owed',
): Promise<VendorDueRow[]> {
  return tsql<VendorDueRow[]>`
    select v.id, v.code, v.name, c.name as category_name,
           v.payment_terms, v.phone,
           d.balance::text as balance,
           d.purchased::text as purchased,
           d.paid::text as paid,
           lp.last_paid_date::text as last_paid_date,
           case when lp.last_paid_date is null then null
                -- business_date(now()), not current_date: "paid 3 days ago" must
                -- count from the day the restaurant is working, or the answer
                -- changes at midnight while the shift is still running.
                else (business_date(now()) - lp.last_paid_date)::int end as days_since_payment
    from vendor_dues d
    join vendors v on v.id = d.vendor_id
    join categories c on c.code = v.primary_category
    left join (
      select vendor_id, max(paid_date) as last_paid_date
      from payments group by vendor_id
    ) lp on lp.vendor_id = v.id
    where v.restaurant_id = ${restaurantId}
      -- OWED is the default because this list is a payment QUEUE: a vendor at
      -- zero is not a job. But filtering on a non-zero balance also makes a
      -- live, fully-settled vendor invisible, which is a different fact and
      -- worth being able to see — so the filter is a view, not a hard-coded
      -- truth. (No backticks in a comment inside a template literal: one would
      -- close the template.)
      ${filter === 'owed' ? sql`and d.balance <> 0` : filter === 'settled' ? sql`and d.balance = 0` : sql``}
    order by d.balance desc, v.name asc`
}

export async function listVendors(restaurantId: string, q: string): Promise<VendorListRow[]> {
  const like = `%${q}%`
  return tsql<VendorListRow[]>`
    select v.id, v.code, v.name, c.name as category_name, v.status,
           -- CARRIED SO THE LIST CAN SAY WHO CANNOT BE SENT AN ORDER. Not one
           -- of the five active vendors has a number, which is invisible on a
           -- list that shows only names and balances — and is the difference
           -- between a purchase order and a PDF.
           nullif(btrim(coalesce(v.phone, '')), '') as phone,
           coalesce(d.balance, 0)::text as balance
    from vendors v
    join categories c on c.code = v.primary_category
    left join vendor_dues d on d.vendor_id = v.id
    where v.restaurant_id = ${restaurantId}
      and (v.name ilike ${like} or v.code ilike ${like})
    order by v.status asc, v.code asc`
}

export async function getVendorDetail(restaurantId: string, id: string): Promise<VendorDetail | null> {
  const rows = await tsql<VendorDetail[]>`
    select v.id, v.code, v.name, v.primary_category, c.name as category_name,
           v.supplies, v.gstin, v.phone, v.payment_terms, v.status, v.created_at::text as created_at,
           v.contact_person, v.alt_phone, v.email, v.address,
           v.bank_name, v.account_no, v.ifsc, v.upi_id,
           v.nature_of_supply, coalesce(v.opening_balance, 0)::text as opening_balance, v.notes,
           -- A CLOSED CODE STAYS RESOLVABLE, the same as an item's.
           v.merged_into, mv.code as merged_into_code, mv.name as merged_into_name,
           coalesce(d.balance, 0)::text as balance,
           coalesce(d.purchased, 0)::text as purchased,
           coalesce(d.paid, 0)::text as paid
    from vendors v
    join categories c on c.code = v.primary_category
    left join vendors mv on mv.restaurant_id = v.restaurant_id and mv.id = v.merged_into
    left join vendor_dues d on d.vendor_id = v.id
    where v.restaurant_id = ${restaurantId} and v.id = ${id}`
  return rows[0] ?? null
}

export async function getVendorPayments(vendorId: string): Promise<PaymentRow[]> {
  return tsql<PaymentRow[]>`
    select id, doc_no, paid_date::text as paid_date, amount::text as amount, mode, note,
           created_at::text as created_at
    from payments
    where vendor_id = ${vendorId}
    order by paid_date desc, created_at desc
    limit 200`
}

export async function getDues(vendorId: string): Promise<DuesSnap> {
  const rows = await tsql<DuesSnap[]>`
    select coalesce(d.balance, 0)::text as balance,
           coalesce(d.purchased, 0)::text as purchased,
           coalesce(d.paid, 0)::text as paid
    from vendors v
    left join vendor_dues d on d.vendor_id = v.id
    where v.id = ${vendorId}`
  return rows[0] ?? { balance: '0', purchased: '0', paid: '0' }
}

export async function listItems(restaurantId: string, q: string): Promise<ItemListRow[]> {
  const like = `%${q}%`
  return tsql<ItemListRow[]>`
    select i.id, i.code, i.name, c.name as category_name, i.purchase_unit, i.status,
           r.prefill_rate::text as prefill_rate
    from items i
    join categories c on c.code = i.category
    left join item_rates r on r.item_id = i.id
    where i.restaurant_id = ${restaurantId}
      and (i.name ilike ${like} or i.code ilike ${like})
    order by i.status asc, i.code asc`
}

export async function getItemDetail(restaurantId: string, id: string): Promise<ItemDetail | null> {
  const rows = await tsql<ItemDetail[]>`
    select i.id, i.code, i.name, i.category, c.name as category_name,
           i.purchase_unit, pu.name as purchase_unit_name,
           i.stock_unit, su.name as stock_unit_name,
           i.conversion_factor::text as conversion_factor,
           i.opening_rate::text as opening_rate,
           i.gst_rate::text as gst_rate,
           i.par_level::text as par_level,
           i.tracks_expiry,
           i.brand, i.status, i.created_at::text as created_at,
           i.reorder_level::text as reorder_level,
           i.default_vendor_id, dv.name as default_vendor_name,
           i.item_type, i.notes, i.storage_location_id,
           -- A CLOSED CODE STAYS RESOLVABLE. The survivor is joined here so the
           -- page can say what this became rather than showing a dead row.
           i.merged_into, mi.code as merged_into_code, mi.name as merged_into_name,
           r.prefill_rate::text as prefill_rate,
           r.last_rate::text as last_rate,
           r.last_rate_date::text as last_rate_date
    from items i
    join categories c on c.code = i.category
    join units pu on pu.code = i.purchase_unit
    left join units su on su.code = i.stock_unit
    left join vendors dv on dv.id = i.default_vendor_id
    left join items mi on mi.restaurant_id = i.restaurant_id and mi.id = i.merged_into
    left join item_rates r on r.item_id = i.id
    where i.restaurant_id = ${restaurantId} and i.id = ${id}`
  return rows[0] ?? null
}

export async function getItemHistory(restaurantId: string, itemId: string): Promise<ItemHistoryRow[]> {
  return tsql<ItemHistoryRow[]>`
    select h.purchase_id, h.bill_date::text as bill_date, h.bill_no, h.vendor_name,
           h.qty::text as qty, h.rate::text as rate, h.amount::text as amount, h.landed::text as landed
    from item_purchase_history h
    where h.restaurant_id = ${restaurantId} and h.item_id = ${itemId}
    order by h.bill_date desc, h.purchase_id desc
    limit 100`
}
