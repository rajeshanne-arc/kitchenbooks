// THE TWO GATES THAT DECIDE WHETHER A COMPARISON MAY BE DRAWN AT ALL.
//
// They live here rather than inline in <Compare> for one reason: they are the
// whole of the correctness, and a predicate that only exists inside a component
// cannot be asserted by value. One definition, read by the screen and by the
// gate.

import type { Baseline } from '@/lib/period'

/** Below this, a percentage is arithmetic about entry habits rather than about
 *  the business: the baseline must carry at least half the current window's
 *  active days before a ratio between them means anything. */
export const THIN_RATIO = 2

/**
 * GATE 1 — THE BOOKS DID NOT EXIST.
 *
 * Not "there is nothing to compare" but "there could not have been". A zero
 * drawn from a window that predates the first entry renders as a total collapse
 * or as an infinite rise from nothing, and neither announces itself.
 *
 * `firstEntry` is read PER MEASURE at query time and is never a constant —
 * purchases began 5 Jun, issues 28 Aug, wastage has not begun.
 */
export function cannotAssess(baseline: Baseline, firstEntry: string | null): boolean {
  if (baseline.kind === 'none') return false
  return firstEntry === null || baseline.from < firstEntry
}

/**
 * GATE 2 — THE BASELINE IS TOO THIN.
 *
 * ONE-SIDED, DELIBERATELY. Only the BASELINE is tested: a thin CURRENT period
 * is NEWS — something stopped — and gating it would hide the finding.
 *
 * GATE 1 SUBSUMES THIS ONE for any measure inside its first partial month, and
 * that is not an overlap to remove: standing in September, August's window
 * starts on the 1st while the first issue is the 28th, so the stronger refusal
 * is the correct one. An August total built from four days of one is not a
 * month to divide by, thin or otherwise.
 */
export function baselineTooThin(thenDays: number, nowDays: number): boolean {
  return thenDays * THIN_RATIO < nowDays
}
