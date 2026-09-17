import 'server-only'
import { tsql } from '@/lib/db'
import type postgres from 'postgres'

// MONEY THAT HAS GONE OUT AND HAS NOT COME BACK.
//
// Three shapes, one question. A salary advance is repaid out of the next
// payroll; a loan is the same thing with an instalment and an end date; a
// vendor credit is money the vendor is holding because we overpaid. All three
// are the business's money sitting somewhere else.
//
// THE SPLIT LIVES IN `advances_ledger`, NOT HERE. The view already decides
// which is which — outstanding > 0 with no instalment is an advance, with one
// is a loan, and vendor_dues below zero is a credit — and restating that in a
// WHERE clause here would be a second expression of one rule, which this file
// has watched drift four times.
//
// BUT `since` IS NOT READ FROM IT, AND THAT IS DELIBERATE. The column means
// three different things by kind: NULL for an advance, `last_bill` for a
// vendor credit — a PAST date — and `expected_end` for a loan, which is a
// FUTURE one. Rendering it under one word would print "since Apr 2027". The
// dates come from `staff_owes.expected_end` and `vendor_credit.last_bill`,
// where they are named for what they are.

export type LedgerLine = {
  kind: string
  subject_code: string
  subject: string
  amount: string
  exposure: string | null
}

/** THE KINDS ARE THE VIEW'S, never a list here — it emits exactly these three
 *  and a fourth would arrive with no section rather than silently joining one. */
export const LEDGER_KINDS = ['salary advance', 'loan', 'vendor credit'] as const

/** @scope now */
export async function getAdvancesLedger(
  restaurantId: string,
  tx?: postgres.TransactionSql,
): Promise<LedgerLine[]> {
  const q = (tx ?? tsql) as typeof tsql
  return q<LedgerLine[]>`
    select kind, subject_code, subject, amount::text as amount, exposure::text as exposure
    from advances_ledger
    where restaurant_id = ${restaurantId}
    order by amount desc`
}

export type StaffOwed = {
  staff_id: string
  code: string
  name: string
  staff_status: string
  base_salary: string | null
  advances_given: string | null
  loans_given: string | null
  instalment: string | null
  expected_end: string | null
  recovered: string
  outstanding: string
  months_of_salary: string | null
}

/**
 * WHAT EACH PERSON OWES, with everything a loan needs to show progress.
 *
 * `recovered` is the sum over ALL of that person's payroll lines, not per
 * advance — so where somebody holds an advance AND a loan at once the split
 * between them is not recoverable from this view. The screens say so rather
 * than inventing an attribution; see `loanProgress`.
 */
/** @scope now */
export async function listStaffOwed(
  restaurantId: string,
  tx?: postgres.TransactionSql,
): Promise<StaffOwed[]> {
  const q = (tx ?? tsql) as typeof tsql
  return q<StaffOwed[]>`
    select staff_id::text as staff_id, code, name, staff_status,
           base_salary::text as base_salary,
           advances_given::text as advances_given, loans_given::text as loans_given,
           instalment::text as instalment, expected_end::text as expected_end,
           recovered::text as recovered, outstanding::text as outstanding,
           months_of_salary::text as months_of_salary
    from staff_owes
    where restaurant_id = ${restaurantId} and outstanding > 0
    order by outstanding desc`
}

/** One person, for their own profile. Returns null where they owe nothing —
 *  which is not the same as a failed read, and the caller says which. */
/** @scope now */
export async function getStaffOwed(
  restaurantId: string,
  staffId: string,
  tx?: postgres.TransactionSql,
): Promise<StaffOwed | null> {
  const q = (tx ?? tsql) as typeof tsql
  const [row] = await q<StaffOwed[]>`
    select staff_id::text as staff_id, code, name, staff_status,
           base_salary::text as base_salary,
           advances_given::text as advances_given, loans_given::text as loans_given,
           instalment::text as instalment, expected_end::text as expected_end,
           recovered::text as recovered, outstanding::text as outstanding,
           months_of_salary::text as months_of_salary
    from staff_owes
    where restaurant_id = ${restaurantId} and staff_id = ${staffId}`
  return row ?? null
}

export type VendorCredit = {
  vendor_id: string
  code: string
  name: string
  credit: string
  last_bill: string | null
  payment_terms: string | null
  days_since_bill: number | null
}

/**
 * WHAT A SUPPLIER IS HOLDING, and how long since we last bought from them.
 *
 * THE DAYS ARE THE WHOLE SIGNAL. A credit with a supplier we still buy from
 * absorbs itself against the next bill and needs nobody; one with a supplier
 * we have stopped using never comes back as goods and has to be chased as
 * cash. The rupees alone cannot tell those apart.
 *
 * AGAINST THE BUSINESS DAY, passed in — never CURRENT_DATE, which under a UTC
 * session disagrees with the restaurant's own day for part of every night.
 */
/** @scope now */
export async function listVendorCredit(
  restaurantId: string,
  today: string,
  tx?: postgres.TransactionSql,
): Promise<VendorCredit[]> {
  const q = (tx ?? tsql) as typeof tsql
  return q<VendorCredit[]>`
    select vendor_id::text as vendor_id, code, name,
           credit::text as credit, last_bill::text as last_bill, payment_terms,
           case when last_bill is null then null
                else (${today}::date - last_bill)::int end as days_since_bill
    from vendor_credit
    where restaurant_id = ${restaurantId}
    order by credit desc`
}

/** One vendor, for their own page. */
/** @scope now */
export async function getVendorCredit(
  restaurantId: string,
  vendorId: string,
  today: string,
  tx?: postgres.TransactionSql,
): Promise<VendorCredit | null> {
  const q = (tx ?? tsql) as typeof tsql
  const [row] = await q<VendorCredit[]>`
    select vendor_id::text as vendor_id, code, name,
           credit::text as credit, last_bill::text as last_bill, payment_terms,
           case when last_bill is null then null
                else (${today}::date - last_bill)::int end as days_since_bill
    from vendor_credit
    where restaurant_id = ${restaurantId} and vendor_id = ${vendorId}`
  return row ?? null
}

/**
 * WHO CAN BE ADVANCED MONEY FROM THE DRAWER.
 *
 * SALARIED, ACTIVE, AND NOT CONTRACT. An advance is recovered from a payroll
 * run, and a run excludes contract staff — they are billed by their vendor —
 * so lending to one through this form would open a debt the only recovery
 * mechanism cannot reach. `getPayrollDraft` has excluded them since phase 5
 * for the same reason; this mirrors it rather than restating why.
 *
 * NARROWED ON THE SERVER. `listStaffIdentities` carries bank account numbers,
 * PAN and dates of birth, and a cashier picking somebody to hand ₹500 to needs
 * none of them — so nothing on that screen is sent them. LAW 1 applied to a
 * payload rather than to a link.
 *
 * @scope not-a-figure
 */
export async function listAdvanceable(
  restaurantId: string,
  tx?: postgres.TransactionSql,
): Promise<{ id: string; name: string; code: string }[]> {
  const q = (tx ?? tsql) as typeof tsql
  return q<{ id: string; name: string; code: string }[]>`
    select id::text as id, name, code
    from staff
    where restaurant_id = ${restaurantId}
      and status = 'active'
      and employment_type <> 'contract'
    order by code asc`
}

export type FulfillableRequest = {
  id: string
  amount: string
  reason: string
  decided_at: string | null
  decided_by: string | null
  instalment: string | null
  expected_end: string | null
}

/**
 * APPROVED ADVANCE REQUESTS FOR ONE PERSON THAT NOTHING HAS FULFILLED YET.
 *
 * An approved request is a decision; the money moves when somebody records
 * it. This is the list of decisions still waiting for that, so the person
 * recording the advance can say WHICH one it settles rather than leaving an
 * approval standing open forever beside a row that quietly satisfied it.
 *
 * UNFULFILLED IS DERIVED, NOT FLAGGED. A request is fulfilled exactly when a
 * `staff_advances` row names it — there is no second column to keep in step,
 * so the list cannot disagree with the ledger.
 *
 * The instalment and end date the REQUEST asked for come out of its snapshot,
 * so choosing one can prefill the form with what was actually approved rather
 * than making somebody retype it and get it wrong.
 *
 * @scope not-a-figure
 */
export async function listFulfillableRequests(
  restaurantId: string,
  staffId: string,
  tx?: postgres.TransactionSql,
): Promise<FulfillableRequest[]> {
  const q = (tx ?? tsql) as typeof tsql
  const rows = await q<
    (Omit<FulfillableRequest, 'instalment' | 'expected_end'> & { snapshot: unknown })[]
  >`
    select a.id::text as id, a.amount::text as amount, a.reason,
           a.decided_at::text as decided_at, a.decided_by, a.snapshot
    from approval_requests a
    where a.restaurant_id = ${restaurantId}
      and a.kind = 'advance'
      and a.entity_type = 'staff'
      and a.entity_id = ${staffId}
      and a.status = 'approved'
      and not exists (
        select 1 from staff_advances s
        where s.restaurant_id = a.restaurant_id and s.approved_request_id = a.id
      )
    order by a.decided_at asc nulls last`
  return rows.map((r) => {
    // A SNAPSHOT THAT WILL NOT READ IS NOT AN EMPTY ONE. The request still
    // stands and is still fulfillable; what is missing is the shape it asked
    // for, so those come back null and the form asks rather than assuming a
    // one-off.
    const snap = r.snapshot
    const obj = snap !== null && typeof snap === 'object' ? (snap as Record<string, unknown>) : null
    const str = (k: string) => {
      const v = obj?.[k]
      return typeof v === 'string' && v !== '' ? v : null
    }
    return { ...r, instalment: str('instalment'), expected_end: str('expectedEnd') }
  })
}

/** Refusals from the advance-fulfilment guard, in its own words. */
export class AdvanceRefusal extends Error {}

/**
 * MAY THIS REQUEST BE SETTLED BY THIS ADVANCE, RIGHT NOW — read under the lock.
 *
 * IT LIVES HERE, NOT IN THE ACTION FILE, for the reason `applyRequest` and
 * `assertWithdrawable` do: every export from a `'use server'` file is a public
 * endpoint, and this decides whether money may be recorded against an approval
 * on the strength of ids passed IN. Living here is also what lets a gate run
 * the APP'S OWN rule rather than a copy of it.
 *
 * FOR UPDATE, because the whole point is that a second screen holding the same
 * approved request must lose. There is NO unique index on
 * `staff_advances.approved_request_id` — measured, not assumed — so this guard
 * is the only thing standing between one approval and two debts.
 */
export async function assertFulfillable(
  tx: postgres.TransactionSql,
  restaurantId: string,
  requestId: string,
  staffId: string,
): Promise<string> {
  const [req] = await tx<{ amount: string; status: string; entity_id: string }[]>`
    select amount::text as amount, status, entity_id::text as entity_id
    from approval_requests
    where id = ${requestId} and restaurant_id = ${restaurantId} and kind = 'advance'
    for update`
  if (!req) throw new AdvanceRefusal('That advance request is not on this restaurant’s books')
  if (req.entity_id !== staffId) {
    throw new AdvanceRefusal(
      'That request was approved for somebody else — an advance cannot settle another person’s',
    )
  }
  if (req.status !== 'approved') {
    throw new AdvanceRefusal(
      req.status === 'applied'
        ? 'That request has already been recorded — an approval settles once, or the same debt is entered twice'
        : `That request is ${req.status}, not approved — only an approved one can be recorded`,
    )
  }
  const [already] = await tx<{ n: number }[]>`
    select count(*)::int as n from staff_advances
    where restaurant_id = ${restaurantId} and approved_request_id = ${requestId}`
  if (already.n > 0) {
    throw new AdvanceRefusal('An advance already names that request — it settles once')
  }
  return req.amount
}
