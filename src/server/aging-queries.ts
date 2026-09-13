import 'server-only'
import { tsql } from '@/lib/db'
import type { BillOutstandingRow, VendorAgingRow, AgingCheck } from '@/lib/types'

/**
 * WHO DO I PAY — answered by WHEN, not by HOW MUCH.
 *
 * `vendor_dues` has always ranked the payment queue by balance, which answers
 * a different question: who is owed most. The person standing at this screen
 * is asking who is OVERDUE, and the two orders disagree on live data —
 * K.RAJA is due 19 July for ₹10,458 and sits near the bottom by balance.
 *
 * bills_outstanding allocates payments FIFO, because payments here are ON
 * ACCOUNT: nothing ties a payment to a bill, so the oldest bill clears first
 * and the opening balance clears before any of them, being older than all.
 */

/** @scope now */
export async function listVendorAging(restaurantId: string): Promise<VendorAgingRow[]> {
  return tsql<VendorAgingRow[]>`
    select vendor_id, vendor_code, vendor_name, payment_terms,
           outstanding::text as outstanding,
           coalesce(terms_not_set, 0)::text as terms_not_set,
           oldest_due::text as oldest_due,
           latest_unpaid_bill::text as latest_unpaid_bill,
           open_bills::int as open_bills
    from vendor_aging
    where restaurant_id = ${restaurantId}
    -- OLDEST DUE FIRST, and a vendor whose due date could not be worked out
    -- sorts LAST rather than first: a null is not an overdue date, and
    -- putting nulls first would promote the vendors we know least about.
    order by oldest_due asc nulls last, outstanding desc`
}

/**
 * TWO INDEPENDENT CALCULATIONS THAT MUST AGREE.
 *
 * `vendor_dues` is opening + purchased − paid, a flat balance.
 * `vendor_aging` is the FIFO remainder summed over unpaid bills.
 * They reach the same number by different routes, and printing the check is
 * what makes the ageing worth trusting — the item ledger's rule, which this
 * repo already records: a second source that agrees 99% of the time is worse
 * than no second source at all.
 *
 * Compared in SQL at full numeric precision. Summing rounded paise on the page
 * would disagree by a paise on a large book and read as a missing bill.
 *
 * @scope now
 */
export async function getAgingCheck(restaurantId: string): Promise<AgingCheck> {
  const [row] = await tsql<AgingCheck[]>`
    with a as (select coalesce(sum(outstanding), 0) as v from vendor_aging where restaurant_id = ${restaurantId}),
         d as (select coalesce(sum(balance), 0) as v from vendor_dues where restaurant_id = ${restaurantId}),
         n as (select count(*)::int as c from vendor_aging va
               join vendor_dues vd on vd.restaurant_id = va.restaurant_id and vd.vendor_id = va.vendor_id
               where va.restaurant_id = ${restaurantId} and va.outstanding <> vd.balance)
    select a.v::text as aging, d.v::text as dues, (a.v = d.v) as agrees, n.c as disagreeing
    from a, d, n`
  return row ?? { aging: '0', dues: '0', agrees: true, disagreeing: 0 }
}

/**
 * WHAT A BALANCE IS MADE OF. A figure with no composition is a figure nobody
 * can check, so the payment screen states the bills it is settling.
 *
 * @scope now
 */
export async function listBillsOutstanding(
  restaurantId: string,
  vendorId: string,
): Promise<BillOutstandingRow[]> {
  return tsql<BillOutstandingRow[]>`
    select purchase_id, bill_no, bill_date::text as bill_date,
           bill_total::text as bill_total, unpaid::text as unpaid,
           due_date::text as due_date, net_days::int as net_days
    from bills_outstanding
    where restaurant_id = ${restaurantId} and vendor_id = ${vendorId} and unpaid > 0
    order by bill_date asc, bill_no asc`
}

/** One vendor's row from the ageing, for the form's prefill. @scope now */
export async function getVendorAging(
  restaurantId: string,
  vendorId: string,
): Promise<VendorAgingRow | null> {
  const [row] = await tsql<VendorAgingRow[]>`
    select vendor_id, vendor_code, vendor_name, payment_terms,
           outstanding::text as outstanding,
           coalesce(terms_not_set, 0)::text as terms_not_set,
           oldest_due::text as oldest_due,
           latest_unpaid_bill::text as latest_unpaid_bill,
           open_bills::int as open_bills
    from vendor_aging
    where restaurant_id = ${restaurantId} and vendor_id = ${vendorId}`
  return row ?? null
}
