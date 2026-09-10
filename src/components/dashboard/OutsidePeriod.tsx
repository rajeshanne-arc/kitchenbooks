/**
 * A FIGURE THAT DOES NOT MOVE WHEN THE PERIOD ABOVE IT MOVES, SAYING SO.
 *
 * A reader looking at a period control above a figure is asking ONE question:
 * WHAT WOULD THIS BE FOR MY DATES? "It ignores the dates" leaves that
 * unanswered, so the preferred form ANSWERS it — the vendor statement's shape:
 *
 *   "This statement stops at 31 Aug. Their balance today is ₹12,500."
 *
 * BOTH FIGURES, wherever both exist. Where only one exists — an alarm tile, a
 * readiness block, a balance with no period counterpart — the roster's shape is
 * the right one: "A headcount is a fact about now, not about the period above."
 *
 * `basis` is REQUIRED and has NO DEFAULT, and it picks the LEAD, so it has a
 * reader rather than being a label for a gate. That is the `WhyNoRange` /
 * `DivergingBars.polarity` rule: a component named or defaulted for one of its
 * cases gets reused into a lie. The three bases are not synonyms —
 *
 *   now       a BALANCE or a state as it stands. Moves every day, but not with
 *             the dates. Vendor dues, negative stock, what is due to reorder.
 *   all-time  EVERYTHING ON RECORD since the first entry. A disagreement or a
 *             settled short from six weeks ago is still on the books.
 *   way-in    not a measurement at all — a door. The recent-days strip exists
 *             to be clicked, so narrowing it would only make it a worse door.
 *
 * ONE COMPONENT, not one sentence per tile. Five tiles each carrying their own
 * copy is how a vocabulary fragments into near-synonyms, and this file already
 * records where that ends: honesty verdicts multiplying into clusters nobody
 * can tell apart. The LEAD is fixed here; the call site supplies only the fact.
 */
const LEAD = {
  'now': 'As of today.',
  'all-time': 'Everything on record.',
  'way-in': 'A way in, not a measurement.',
} as const

export default function OutsidePeriod({
  basis,
  what,
  className = '',
}: {
  basis: keyof typeof LEAD
  what: string
  className?: string
}) {
  return (
    <p className={`text-xs text-stone-500 ${className}`}>
      <span className="font-medium text-stone-600">{LEAD[basis]}</span> {what}
    </p>
  )
}
