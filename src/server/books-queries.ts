// Read side of Books. Derived numbers always come from the named views:
// bills (totals, line_count, is_voided/is_reversal), vendor_dues (balances),
// item_rates (prefill), item_purchase_history (history). Raw event columns
// (e.g. purchases.reverses_id for linking) may be read directly — they are
// facts, not recomputations.
import 'server-only'
import { sql, tsql } from '@/lib/db'
import { includeClosed } from '@/lib/closed'
import type {
  BillLine,
  BillRow,
  DuesSnap,
  ItemDetail,
  ItemLedgerRow,
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

export async function listVendors(
  restaurantId: string,
  q: string,
  showClosed = false,
): Promise<VendorListRow[]> {
  const like = `%${q}%`
  const closed = includeClosed(q, showClosed)
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
      ${closed ? sql`` : sql`and v.status not in ('merged', 'discarded')`}
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

export async function listItems(
  restaurantId: string,
  q: string,
  showClosed = false,
): Promise<ItemListRow[]> {
  const like = `%${q}%`
  // BROWSING HIDES A CLOSED ROW; SEARCHING FINDS IT. See src/lib/closed.ts —
  // a merged code has to stay resolvable, so a query text turns the filter off
  // by itself. Answering "no such item" for a code somebody read off an old
  // bill is the worst possible reading of "archived".
  const closed = includeClosed(q, showClosed)
  return tsql<ItemListRow[]>`
    select i.id, i.code, i.name, c.name as category_name, i.purchase_unit, i.status,
           r.prefill_rate::text as prefill_rate,
           m.code as merged_into_code,
           a.reason as closed_reason, a.decided_by as closed_by
    from items i
    join categories c on c.code = i.category
    left join item_rates r on r.item_id = i.id
    left join items m on m.restaurant_id = i.restaurant_id and m.id = i.merged_into
    -- WHY IT WAS CLOSED, AND WHO SAID SO. After a discard there is no negative
    -- twin to read; the approval's reason is the only account of it that will
    -- ever exist, so the row that survives carries it.
    left join lateral (
      select ar.reason, ar.decided_by from approval_requests ar
      where ar.restaurant_id = i.restaurant_id and ar.entity_id = i.id and ar.status = 'applied'
      order by ar.applied_at desc limit 1
    ) a on true
    where i.restaurant_id = ${restaurantId}
      and (i.name ilike ${like} or i.code ilike ${like})
      ${closed ? sql`` : sql`and i.status not in ('merged', 'discarded')`}
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

/** The item's POSITION, from the view that owns it — never recomputed here.
 *  The ledger sums the movements; this is the independent second opinion the
 *  page holds it against. */
export async function getItemStock(
  restaurantId: string,
  itemId: string,
): Promise<{ on_hand_qty: string; on_hand_value: string; issue_cost: string | null } | null> {
  const rows = await tsql<{ on_hand_qty: string; on_hand_value: string; issue_cost: string | null }[]>`
    select on_hand_qty::text as on_hand_qty, on_hand_value::text as on_hand_value,
           issue_cost::text as issue_cost
    from stock_on_hand
    where restaurant_id = ${restaurantId} and item_id = ${itemId}`
  return rows[0] ?? null
}

/**
 * THE ITEM'S MOVEMENT LEDGER — every row that moved this item, oldest first,
 * with the balance after each.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE VOID TRAP, AND IT IS THE WHOLE RISK IN THIS QUERY.
 *
 * `stock_on_hand` sums the same six sources and uses TWO DIFFERENT
 * CONVENTIONS for reversals. Read from the view rather than remembered:
 *
 *   returns, vendor_returns  — BOTH halves EXCLUDED. Their line tables carry
 *                              CHECK (qty > 0), so a reversal cannot be a
 *                              negative twin; the void is marked on the PARENT
 *                              and the view drops the reversal AND the document
 *                              it reverses.
 *   purchases, issues, wastage, stock_adjustments
 *                            — NO FILTER. The reversal carries negative
 *                              quantities and the pair cancels arithmetically.
 *
 * This ledger replicates EACH SOURCE'S OWN convention. Applying one of them to
 * all six makes the balance disagree with the view — and disagree by an amount
 * that looks like a rounding bug rather than a missing document.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * TWO THINGS THAT LOOK LIKE MOVEMENTS AND ARE NOT, deliberately absent:
 *
 *   stock_count_lines  — a count records what was SEEN. The stock_adjustment
 *                        written when the count is ACCEPTED is what moved the
 *                        book. Including both double-counts every correction,
 *                        and it is a natural mistake because a count feels like
 *                        a movement.
 *   purchase_line_shorts — `purchase_lines.qty` already means WHAT ARRIVED, so
 *                        a short never moved any stock. That is the entire
 *                        reason shorts are their own table.
 *
 * EVERY SOURCE FILTERS ON restaurant_id EXPLICITLY. The view leans on `items`
 * being tenant-filtered while its subqueries group globally; that is not a
 * property to inherit. Tenant isolation is not a thing to be clever about.
 *
 * ORDERED BY (date, id). NOT created_at: it defaults to now(), which is the
 * TRANSACTION timestamp, and the sheet import wrote all 1,101 purchase lines in
 * one transaction — so every purchase row in this tenant shares one instant.
 * `id` is random but deterministic, which is what a stable render needs.
 *
 * THE BALANCE IS COMPUTED OVER EVERY ROW AND THE NEWEST SLICE IS TAKEN AFTER.
 * The obvious form — newest 200, then a window function — starts the running
 * balance wherever row 201 left off, and is silently wrong on any item with
 * more than 200 movements. The window must see everything.
 */
export async function getItemLedger(
  restaurantId: string,
  itemId: string,
  limit = 200,
): Promise<{ rows: ItemLedgerRow[]; total: number }> {
  const rows = await tsql<ItemLedgerRow[]>`
    with moves as (
      -- PURCHASE (+). No void filter: a voided bill's lines carry negative
      -- quantities and the pair cancels, exactly as the view sums it.
      select p.bill_date as move_date, pl.id as row_id, 'Purchase' as kind,
             pl.qty as signed_qty,
             coalesce(nullif(p.bill_no, ''), p.doc_no, '—') as ref,
             v.name as party, null::text as detail
      from purchase_lines pl
      join purchases p on p.restaurant_id = pl.restaurant_id and p.id = pl.purchase_id
      join vendors v on v.restaurant_id = p.restaurant_id and v.id = p.vendor_id
      where pl.restaurant_id = ${restaurantId} and pl.item_id = ${itemId}

      union all
      -- ISSUE (−). No void filter, same reason.
      select i.issue_date, il.id, 'Issue', -il.qty,
             coalesce(s.name, '—'), null, i.session
      from issue_lines il
      join issues i on i.restaurant_id = il.restaurant_id and i.id = il.issue_id
      left join sections s on s.id = i.section_id
      where il.restaurant_id = ${restaurantId} and il.item_id = ${itemId}

      union all
      -- RETURN FROM A DEPARTMENT (+). BOTH halves of a reversed pair dropped:
      -- return_lines has CHECK (qty > 0), so the void is marked on the parent.
      select r.return_date, rl.id, 'Return', rl.qty,
             coalesce(s.name, '—'), null, coalesce(rl.reason, r.reason)
      from return_lines rl
      join returns r on r.restaurant_id = rl.restaurant_id and r.id = rl.return_id
      left join sections s on s.id = r.section_id
      where rl.restaurant_id = ${restaurantId} and rl.item_id = ${itemId}
        and r.reverses_id is null
        and not exists (select 1 from returns x where x.restaurant_id = r.restaurant_id and x.reverses_id = r.id)

      union all
      -- WASTAGE (−). No void filter.
      select w.waste_date, w.id, 'Wastage', -w.qty, w.reason, null, w.note
      from wastage w
      where w.restaurant_id = ${restaurantId} and w.item_id = ${itemId}

      union all
      -- ADJUSTMENT (±). qty is already signed. No void filter.
      select a.adj_date, a.id, 'Adjustment', a.qty, a.reason, null,
             case when a.count_id is null then 'standalone — opening stock or a correction'
                  else 'from the count of ' || to_char(c.count_date, 'DD Mon YYYY') end
      from stock_adjustments a
      left join stock_counts c on c.restaurant_id = a.restaurant_id and c.id = a.count_id
      where a.restaurant_id = ${restaurantId} and a.item_id = ${itemId}

      union all
      -- BACK TO THE VENDOR (−). BOTH halves dropped, same as returns.
      select vr.return_date, vrl.id, 'Vendor return', -vrl.qty,
             coalesce(vr.credit_note_ref, vr.reason, '—'), v2.name, vrl.reason
      from vendor_return_lines vrl
      join vendor_returns vr on vr.restaurant_id = vrl.restaurant_id and vr.id = vrl.vendor_return_id
      join vendors v2 on v2.restaurant_id = vr.restaurant_id and v2.id = vr.vendor_id
      where vrl.restaurant_id = ${restaurantId} and vrl.item_id = ${itemId}
        and vr.reverses_id is null
        and not exists (select 1 from vendor_returns x where x.restaurant_id = vr.restaurant_id and x.reverses_id = vr.id)
    ),
    running as (
      select move_date, row_id, kind, signed_qty, ref, party, detail,
             sum(signed_qty) over (order by move_date, row_id
                                   rows between unbounded preceding and current row) as balance
      from moves
    )
    select move_date::text as move_date, row_id, kind, signed_qty::text as signed_qty,
           ref, party, detail, balance::text as balance,
           count(*) over () ::int as total
    from running
    order by move_date desc, row_id desc
    limit ${limit}`
  return { rows, total: rows[0]?.total ?? 0 }
}
