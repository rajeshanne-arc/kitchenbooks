// HOW LATE AN ENTRY IS — pure, so it can be asserted by value.
//
// Lives in lib rather than beside the component for the same reason period.ts
// and fy.ts do: a smoke suite must be able to import it without pulling in
// React, next/link or a client context. The component is the sentence; this is
// the arithmetic, and only the arithmetic can be checked against a table of
// known answers.

/**
 * How far back is ordinary. Yesterday's issues written up this morning are the
 * normal rhythm of a store, and a warning that fires on the normal case is one
 * people learn to dismiss — which costs more than never having built it.
 * Three days is the edge of "I am writing up the week".
 *
 * THE NUMBER IS NEVER IN THE SENTENCE. A reader does not need the threshold;
 * they need to know how late THIS entry is, which is a different number and
 * the only one they can act on.
 */
export const BACKDATE_DAYS = 3

/**
 * Whole days between two ISO dates, positive when `date` is the earlier one.
 *
 * Date.UTC rather than `new Date(iso)` arithmetic: both arguments are business
 * dates resolved on the server, and anchoring them at UTC midnight keeps the
 * subtraction free of the browser's offset and of daylight saving — an hour
 * either way must never round a 3 into a 4.
 *
 * A future date returns negative, so it warns about nothing; an unparseable
 * one returns 0, because a half-typed date in a date field is somebody still
 * typing, not somebody backdating.
 */
export function daysBackdated(date: string, businessDate: string): number {
  const at = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    return m === null ? NaN : Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  const a = at(date)
  const b = at(businessDate)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}
