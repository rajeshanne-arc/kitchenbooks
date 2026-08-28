// ARCHIVED, NOT DELETED — and the difference between three words.
//
//   RETIRED   we stopped using it. It may come back, so it stays on the list,
//             marked, exactly as it is today.
//   DISCARDED it was never real. It must never come back.
//   MERGED    look over there instead.
//
// The industry pattern is unambiguous and this follows it: a discontinued item
// is marked and then ARCHIVED — searchable, but absent from the regular
// inventory view. A list that keeps showing rows nobody may use again is a list
// that gets longer forever and teaches people to scroll past things.
//
// THE RULE THAT SATISFIES BOTH HALVES AT ONCE:
//
//   browsing hides them · SEARCHING FINDS THEM ALWAYS
//
// A merged code has to stay resolvable — looking up HKP-024 must tell you it
// became HKP-015, and that is the entire reason the row was kept rather than
// deleted. So a query text turns the filter off by itself: somebody who types a
// code is asking about that code, and answering "no such item" for a code that
// plainly exists would be the worst reading of "hidden".

/** The two statuses that leave the default list. Retired is NOT one of them. */
export const CLOSED_STATUSES = ['merged', 'discarded'] as const

/**
 * Whether closed rows belong in this result.
 *
 * `q` non-empty means somebody is looking for something specific — including,
 * very often, a code they found on an old bill. `showClosed` is the explicit
 * reveal on the screen.
 */
export const includeClosed = (q: string, showClosed: boolean): boolean =>
  showClosed || q.trim() !== ''
