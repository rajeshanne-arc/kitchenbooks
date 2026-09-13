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
  // THE ROUTING DETAILS TRAVEL WITH THE QUEUE, because the row expands IN
  // PLACE. `modesForVendor` needs to know whether this vendor has an account
  // number and a UPI id to decide which modes may be offered, and fetching
  // that on expand would make opening a row a round trip — an expand that has
  // to FETCH is worse than a link that moves you, because it hangs where a
  // link at least goes somewhere.
  return tsql<VendorAgingRow[]>`
    select a.vendor_id, a.vendor_code, a.vendor_name, a.payment_terms,
           a.outstanding::text as outstanding,
           coalesce(a.terms_not_set, 0)::text as terms_not_set,
           a.oldest_due::text as oldest_due,
           a.latest_unpaid_bill::text as latest_unpaid_bill,
           a.open_bills::int as open_bills,
           v.account_no, v.upi_id
    from vendor_aging a
    join vendors v on v.restaurant_id = a.restaurant_id and v.id = a.vendor_id
    where a.restaurant_id = ${restaurantId}
    -- OLDEST DUE FIRST, and a vendor whose due date could not be worked out
    -- sorts LAST rather than first: a null is not an overdue date, and
    -- putting nulls first would promote the vendors we know least about.
    order by a.oldest_due asc nulls last, a.outstanding desc`
}

/**
 * THE OLDEST THREE UNPAID BILLS PER VENDOR — what each balance is MADE OF.
 *
 * A figure with no composition is a figure nobody can check, and these are the
 * bills a payment actually clears: payments here are ON ACCOUNT and tied to no
 * bill, so FIFO is not a preference, it is what `bills_outstanding` does.
 *
 * CAPPED IN SQL, NOT BY SLICING. 250 unpaid bills across 28 vendors today, and
 * the row expands in place — so the alternative is shipping every one of them
 * to show three. The cap grows with the restaurant and the payload does not;
 * `open_bills` on the ageing row already carries the true count, so "and 14
 * older" is still exact.
 */
export async function listOldestBillsPerVendor(
  restaurantId: string,
): Promise<Record<string, BillOutstandingRow[]>> {
  // A CTE RATHER THAN A DERIVED TABLE, and that is about the gate rather than
  // about taste. audit:schema resolves `from <name> [alias]` and knows the
  // names a `with x as (…)` introduces; it has no way to tell `) ranked` from
  // a bare column, so it read the alias as one and reported
  // `bills_outstanding has no column "ranked"`. Teaching it the construct
  // needs paren matching — a loose `\) word` pattern would swallow
  // `count(*) filter (…)` and start blinding it to real columns. Spelling the
  // same query in the form it already parses costs nothing and is the clearer
  // one to read.
  const rows = await tsql<(BillOutstandingRow & { vendor_id: string })[]>`
    with ranked as (
      select b.vendor_id, b.purchase_id, b.bill_no, b.bill_date, b.due_date, b.unpaid,
             row_number() over (
               partition by b.vendor_id
               order by b.due_date asc nulls last, b.bill_date asc
             ) as rn
      from bills_outstanding b
      where b.restaurant_id = ${restaurantId} and b.unpaid > 0
    )
    select vendor_id, purchase_id, bill_no, bill_date::text as bill_date,
           due_date::text as due_date, unpaid::text as unpaid
    from ranked
    where rn <= 3`
  const out: Record<string, BillOutstandingRow[]> = {}
  for (const r of rows) out[r.vendor_id] = [...(out[r.vendor_id] ?? []), r]
  return out
}

/**
 * TWO INDEPENDENT CALCULATIONS THAT MUST AGREE.
 *
 * `vendor_dues` is opening + purchased - paid, a flat balance.
 * `vendor_aging` is the FIFO remainder summed over unpaid bills.
 * They reach the same number by different routes, and printing the check is
 * what makes the ageing worth trusting.
 *
 * A CHECK THAT ONLY EXAMINES ROWS BOTH SIDES HAVE CANNOT SEE A ROW ONE SIDE
 * LACKS. This inner-joined, and reported "totals differ by 0.61, disagreeing on
 * 0 vendors" — both halves true and useless together. AK TRADERS is OVERPAID by
 * 61 paise, `vendor_dues` shows -0.61, and `vendor_aging` drops them because it
 * filters `unpaid > 0`. The one vendor that differed was the one the comparison
 * could not see. FULL OUTER JOIN, so a vendor missing from either side is still
 * examined.
 *
 * AN OVERPAYMENT IS NOT AN ALARM. It is a credit — the vendor holds our money —
 * and blocking the payment screen over one would stop all paying because of a
 * vendor who owes us. It gets its own line. The alarm is reserved for a vendor
 * present in BOTH views with DIFFERENT figures, which is the only case that
 * means the two calculations actually disagree.
 *
 * Compared in SQL at full numeric precision: summing rounded paise on the page
 * would disagree by a paise on a large book and read as a missing bill.
 *
 * @scope now
 */
export async function getAgingCheck(restaurantId: string): Promise<AgingCheck> {
  const [row] = await tsql<AgingCheck[]>`
    with j as (
      select coalesce(va.vendor_code, vd.code) as code,
             coalesce(va.vendor_name, vd.name) as name,
             va.outstanding as aging,
             vd.balance as dues
      from vendor_aging va
      full outer join vendor_dues vd
        on vd.restaurant_id = va.restaurant_id and vd.vendor_id = va.vendor_id
      where coalesce(va.restaurant_id, vd.restaurant_id) = ${restaurantId}
    )
    select
      coalesce(sum(coalesce(aging, 0)), 0)::text as aging,
      coalesce(sum(coalesce(dues, 0)), 0)::text as dues,
      -- THE ALARM: both views hold this vendor and say different things.
      count(*) filter (where aging is not null and dues is not null and aging <> dues)::int as disagreeing,
      -- ALSO AN ALARM: a real debt one view has entirely lost. Distinguished
      -- from an overpayment, which is a legitimate reason to appear in only one.
      count(*) filter (
        where (aging is null and coalesce(dues, 0) > 0) or (dues is null and coalesce(aging, 0) > 0)
      )::int as missing,
      -- A CREDIT, NOT A FAULT. Named rather than counted: 61 paise is noise and
      -- a mis-keyed payment is not, and the difference is the vendor and the
      -- figure, which a count cannot carry.
      coalesce(
        json_agg(json_build_object('code', code, 'name', name, 'balance', dues::text))
          filter (where coalesce(dues, 0) < 0),
        '[]'::json
      ) as overpaid
    from j`
  return row ?? { aging: '0', dues: '0', disagreeing: 0, missing: 0, overpaid: [] }
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
