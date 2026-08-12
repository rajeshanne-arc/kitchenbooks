// A CARD MUST DECLARE WHAT IT NEEDS BEFORE IT REPORTS WHAT IT FOUND.
//
// The owner dashboard once said, correctly and well, "3 bills and 1 issue
// are recorded for this period, but no sales day has been fetched" — and
// then four cards below it independently reported clean bills of health
// that all depended on exactly that missing data:
//
//   "Every day that sold food has its cash counted"   — over no days
//   "Every order carries a status the app knows"      — over no orders
//   "Everything sold is mapped to a dish"             — over nothing sold
//   "South Indian costs more than it earns"           — a missing divisor
//
// The first three congratulate on an empty set. The fourth reports a
// business problem when the truth is a missing denominator. Each was
// individually defensible and together they were a lie.
//
// So the answer is not better copy on five cards. It is a THIRD STATE. A
// card is not pass/fail; it is pass, fail, or CANNOT BE ASSESSED — and the
// third has to be as visible as the other two, because "we do not know" is
// the finding, not the absence of one.

export type Assessable<T> =
  | { assessable: true; data: T }
  | { assessable: false; needs: string; why: string }

/**
 * Declare what a card rests on. `needs` is the missing thing in three or
 * four words ("no sales fetched"); `why` is the plain sentence saying what
 * cannot therefore be judged.
 */
export function requires<T>(met: boolean, data: T, needs: string, why: string): Assessable<T> {
  return met ? { assessable: true, data } : { assessable: false, needs, why }
}

/**
 * Where an unassessable card sorts.
 *
 * ABOVE everything that is genuinely fine, because not knowing is worse
 * than knowing it is well; BELOW every real finding, because a thing that
 * is actually wrong beats a thing that is merely unmeasured. It must never
 * take a real urgency — the "South Indian costs more than it earns" card
 * ranked 250 on a divisor that did not exist, and pushed true findings down
 * the page.
 */
export const UNASSESSABLE_URGENCY = 60
