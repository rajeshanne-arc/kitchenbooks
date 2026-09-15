// A PAYMENT REQUEST NAMES THE BILLS IT IS ABOUT.
//
// "Pay SRI VYSHNAVI for the first fortnight of August" is the sentence two
// people actually say to each other. A date pair is the only part of it a
// machine can hold, so that is what the request carries.
//
// THE ACCOUNTING DOES NOT CHANGE, AND THIS IS THE LINE TO HOLD. Payments in
// this app are ON ACCOUNT: nothing ties a payment to a bill, and
// `bills_outstanding` allocates FIFO because that is what happens to money
// against a balance, not because anybody chose it. The range is what PEOPLE
// are talking about when they agree a figure; the LEDGER still sees a payment
// against a balance and always will.
//
// So if you find yourself reaching for per-bill allocation because a request
// now names bills — STOP. That is a different product. It would need a join
// table, it would make every payment already on these books unreadable, and
// nothing above this line is asking for it.
//
// DATES ARE ISO 'YYYY-MM-DD' THROUGHOUT, so they compare as strings: exactly,
// with no parsing, no timezone, and no Date object to get wrong at 00:30. The
// business day arrives as a string from the server for the same reason.

import { decimalStringToPaise } from '@/lib/money'

export type DateRange = { from: string; to: string }

/** The shape both sides need — the row type carries more and neither cares. */
type Dated = { bill_date: string; unpaid: string }

/** INCLUSIVE at both ends, matching `daterange(bills_from, bills_to, '[]')`. */
export function inRange<T extends Dated>(bills: readonly T[], r: DateRange): T[] {
  return bills.filter((b) => b.bill_date >= r.from && b.bill_date <= r.to)
}

/**
 * Exact, because `bills_outstanding.unpaid` is 2dp on every row (250 of 250,
 * max scale 2 — measured, not assumed) and paise are integers. This is a
 * PREVIEW: the server recomputes the same figure in SQL at raise and at pay,
 * and its number is the one any refusal names.
 */
export function totalPaise(bills: readonly Dated[]): number {
  return bills.reduce((n, b) => n + decimalStringToPaise(b.unpaid), 0)
}

/**
 * EVERYTHING — which is the default because it is what he means when he has
 * not said otherwise.
 *
 * `to` is the BUSINESS day rather than the calendar one, and `from` is the
 * oldest unpaid bill's own date. A bill cannot be dated after today, so the
 * default covers every unpaid bill and its total equals the outstanding
 * balance exactly. Narrowing it is the deliberate act; widening it is not
 * possible, because there is nothing older.
 *
 * `vendor_aging` publishes `latest_unpaid_bill` and no oldest, so this is
 * computed from the bills themselves rather than read off the ageing row.
 */
export function defaultRange(bills: readonly Dated[], businessToday: string): DateRange | null {
  if (bills.length === 0) return null
  let from = bills[0].bill_date
  let latest = bills[0].bill_date
  for (const b of bills) {
    if (b.bill_date < from) from = b.bill_date
    if (b.bill_date > latest) latest = b.bill_date
  }
  // TODAY IS THE RULE AND THE LATEST BILL IS THE GUARANTEE. A bill dated after
  // today should not exist, and the day one does — a typed year, a device with
  // a wrong clock — ending at today would silently drop it from a range that
  // claims to be everything, and the total would stop equalling the balance
  // with nothing on screen to say why. Widening can hide nothing.
  return { from, to: latest > businessToday ? latest : businessToday }
}

/**
 * INCLUSIVE at both ends, and that has to match the exclusion constraint
 * exactly: `daterange(bills_from, bills_to, '[]') WITH &&`. If the app were
 * half-open and the database inclusive, a request the screen accepted would
 * come back as a constraint violation nobody can read — so the app refuses
 * first, in words, and the constraint is the backstop for a race.
 */
export function overlaps(a: DateRange, b: DateRange): boolean {
  return a.from <= b.to && b.from <= a.to
}

/** Ordered, which the CHECK also requires. An unordered pair is a typo. */
export function ordered(r: DateRange): boolean {
  return r.from !== '' && r.to !== '' && r.from <= r.to
}
