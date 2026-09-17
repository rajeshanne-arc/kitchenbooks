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
