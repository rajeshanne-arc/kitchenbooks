// HOW LATE A VENDOR'S OLDEST BILL IS — derived, never declared.
//
// THERE IS NO URGENCY COLUMN AND THERE SHOULD NOT BE ONE. A self-assessed
// urgent flag becomes always-urgent inside a month — that is near universal —
// and an urgency everybody claims colours nothing. `vendor_aging.oldest_due`
// is a fact nobody can inflate: it comes from the bill date and the payment
// terms the vendor themselves set.
//
// THE HUMAN HALF IS ALREADY ON SCREEN. A reason is REQUIRED on every request,
// so "they are holding tomorrow's delivery" — urgent with no ageing at all —
// is stated in the requester's own words whatever the colour says. If that
// turns out not to be enough, a flag is one column; it would be attributed as
// a CLAIM rather than coloured as a fact.
//
// THE DAYS ARE SAID, NOT ONLY SHOWN. Colour never carries meaning alone in
// this app — "8 weeks late" is readable by somebody who cannot tell the two
// reds apart, and is more precise besides.

export type Lateness =
  | { band: 'weeks'; days: number; text: string }
  | { band: 'late'; days: number; text: string }
  | { band: 'due'; days: number; text: string }
  | { band: 'unknown'; days: null; text: string }

/** A fortnight. Past this a debt has stopped being a slow week and started
 *  being a thing the vendor is chasing. */
const WEEKS_LATE = 14

/** `today` is the BUSINESS day, passed in — never a clock read here. At 00:30
 *  the browser says tomorrow, and a band computed from that would age every
 *  vendor by a day for two hours a night. */
export function lateness(oldestDue: string | null, today: string): Lateness {
  if (oldestDue === null || oldestDue === '') {
    // NOT "not due" — nothing can say when it fell due, which is a different
    // fact and needs its own words rather than borrowing the quiet band's.
    return { band: 'unknown', days: null, text: 'no due date on the books' }
  }
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${oldestDue}T00:00:00Z`)) / 86_400_000,
  )
  if (!Number.isFinite(days)) return { band: 'unknown', days: null, text: 'no due date on the books' }

  if (days <= 0) {
    return {
      band: 'due',
      days,
      text: days === 0 ? 'due today' : days === -1 ? 'due tomorrow' : `due in ${-days} days`,
    }
  }
  if (days < WEEKS_LATE) {
    return { band: 'late', days, text: days === 1 ? '1 day late' : `${days} days late` }
  }
  const weeks = Math.floor(days / 7)
  return { band: 'weeks', days, text: weeks === 1 ? '1 week late' : `${weeks} weeks late` }
}

/** Border and chip tones per band. NEVER the only signal — the text is.
 *  `unknown` wears the amber of a thing to go and look at rather than the
 *  quiet of a thing that is fine: a bill with no due date is not a bill that
 *  is not due. */
export const LATE_TONE: Record<Lateness['band'], { border: string; chip: string }> = {
  weeks: { border: 'border-red-300', chip: 'border-red-200 bg-red-50 text-red-800' },
  late: { border: 'border-amber-300', chip: 'border-amber-200 bg-amber-50 text-amber-900' },
  due: { border: 'border-rule', chip: 'border-stone-200 bg-stone-50 text-stone-600' },
  unknown: { border: 'border-amber-300', chip: 'border-amber-200 bg-amber-50 text-amber-900' },
}
