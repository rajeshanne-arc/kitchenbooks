// THE BUSINESS DAY — what "today" means to a restaurant that serves past
// midnight.
//
// A kitchen closing at 01:30 has a day that does not end at midnight. Thrayam
// has real orders at 00:04, 00:21 and 01:35. PetPooja already knows this — it
// sends `business_date`, so a 00:30 order sits on the previous night. Every
// date this app defaulted itself was the CALENDAR date, so a cashier closing
// at 00:30 filed against the 12th while the sales sat on the 11th, and
// day_close_ladder joined the drawer to the wrong day's POS cash.
//
// So the cutover lives in the database, in `business_date(timestamptz)`, and
// this module is the only way the app asks for it.
//
// IT TAKES NO RESTAURANT ARGUMENT, BY DESIGN. `settings` is RLS'd, so the
// function can only read the tenant announced on the current transaction —
// passing an id would let one tenant ask for another restaurant's day. That
// also means it MUST be called through tsql/txn: on the bare pool there is no
// GUC, and under RLS the settings read finds nothing.
//
// Both halves of the cutover are settings because both vary by restaurant:
// `timezone` and `business_day_start`. A start of 00:00 makes the function a
// no-op, which is correct for anywhere that closes before midnight.
import 'server-only'
import { tsql } from '@/lib/db'

/**
 * Today, as the restaurant counts days. THE default for every date this app
 * records — never the calendar date.
 *
 * DELIBERATELY NOT wrapped in React's `cache`: that only dedupes inside a
 * request render, and the smoke gates call this from plain scripts, where it
 * would be a silent no-op at best. One extra single-statement read per page is
 * a price worth paying for a helper that behaves the same everywhere.
 */
export async function businessToday(): Promise<string> {
  const [row] = await tsql<{ d: string }[]>`select business_date(now())::text as d`
  return row.d
}

/** The business day a given instant belongs to — for asking "which day was
 *  this", never for defaulting a form. */
export async function businessDayOf(at: string): Promise<string> {
  const [row] = await tsql<{ d: string }[]>`select business_date(${at}::timestamptz)::text as d`
  return row.d
}

/** First day of the month the business day falls in. */
export async function businessMonthStart(): Promise<string> {
  return `${(await businessToday()).slice(0, 7)}-01`
}

/**
 * The previous business day — the default Fetch Day target, because
 * yesterday is complete and today is still ringing up.
 */
export async function businessYesterday(): Promise<string> {
  const d = new Date(`${await businessToday()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Both dates and the cutover, in one round trip.
 *
 * The calendar date is NOT what anything files against. It exists so a screen
 * can notice that the business day and the wall clock disagree and say so,
 * which is the whole of requirement 2: a cashier at 00:47 must see
 * "Business day 11 Aug" and the reason, not a date picker showing the 12th
 * that they will helpfully "correct".
 */
export type BusinessDayDisagreement = {
  pos_says: string
  we_say: string
  orders: number
  earliest: string
  latest: string
}

/**
 * Where our cutover and Petpooja's disagree.
 *
 * Any row means the same orders are filed under different days in the two
 * systems — so a figure read here and a figure read in their dashboard will
 * not match, and nobody will be able to say which is wrong. The usual cause is
 * `business_day_start` not matching however the POS was configured.
 *
 * The view compares `business_date` (theirs) against `business_date(order_time)`
 * (ours) and can only speak for orders that carried a time. Emptiness is
 * therefore not proof of agreement, which is why the surfaces that show this
 * also say whether any order carried a time at all.
 */
export async function getBusinessDayDisagreements(
  restaurantId: string,
): Promise<BusinessDayDisagreement[]> {
  return tsql<BusinessDayDisagreement[]>`
    select pos_says::text as pos_says, we_say::text as we_say,
           orders::int as orders,
           earliest::text as earliest, latest::text as latest
    from business_day_disagreements
    where restaurant_id = ${restaurantId}
    order by pos_says desc`
}

/**
 * How many POS orders we could compare at all. Zero means
 * `business_day_disagreements` is empty because nothing carried a time — not
 * because the two systems agree. A sum over no rows is not a zero.
 */
export async function countOrdersWithTime(restaurantId: string): Promise<{ withTime: number; total: number }> {
  const [row] = await tsql<{ with_time: number; total: number }[]>`
    select count(*) filter (where order_time is not null)::int as with_time,
           count(*)::int as total
    from pos_orders where restaurant_id = ${restaurantId}`
  return { withTime: row?.with_time ?? 0, total: row?.total ?? 0 }
}

export async function businessDayContext(): Promise<{
  businessDate: string
  calendarDate: string
  dayStart: string
}> {
  // The settings reads NAME THE TENANT, via the GUC tsql has already
  // announced. RLS would scope them anyway, but a read that only works
  // because a policy is switched on is the shape the tenancy gate exists to
  // refuse — and the gate is right: implicit scoping is invisible in review.
  // Using the GUC keeps it explicit at no extra round trip.
  const [row] = await tsql<{ b: string; c: string; s: string | null }[]>`
    select business_date(now())::text as b,
           (now() at time zone coalesce(
             (select value from settings
               where key = 'timezone'
                 and restaurant_id = current_setting('app.restaurant_id')::uuid),
             'UTC'))::date::text as c,
           (select value from settings
             where key = 'business_day_start'
               and restaurant_id = current_setting('app.restaurant_id')::uuid) as s`
  return { businessDate: row.b, calendarDate: row.c, dayStart: row.s ?? '00:00' }
}
