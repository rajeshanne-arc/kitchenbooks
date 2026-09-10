/**
 * WHERE A PERIOD CONTROL WOULD SIT, ON A SCREEN THAT HAS NO PERIOD.
 *
 *   A CONTROL MUST NOT PROMISE WHAT THE DATA SOURCE CANNOT DELIVER.
 *
 * A date range answers WHAT HAPPENED BETWEEN THESE DATES. A picker on a screen
 * that cannot answer that promises a figure moving when the dates do, and it
 * does not move. The limit can sit in two different places, and they are
 * different sentences to the reader:
 *
 *   state   the data carries NO DATE AT ALL. `stock_on_hand`, `supplier_costs`
 *           and `vendor_performance` have no date column — checked against
 *           information_schema, not assumed. Nothing to widen because there is
 *           nothing to narrow.
 *
 *   source  the data IS dated and SOMEBODY ELSE decides the grain. Petpooja's
 *           Get Orders is keyed to one business date, so a range control would
 *           offer to widen what the API cannot. The limit is not ours.
 *
 * `why` is REQUIRED and has NO DEFAULT, for the reason `DivergingBars.polarity`
 * is: a component that ENCODES one answer rather than taking one gets reused
 * into a lie. This one was called `AsItStands` — the state verdict wearing a
 * component name — and was already mounted on Fetch a day, which is not state.
 *
 * It has a reader rather than being a label for the gate: it picks the LEAD,
 * because the two absences look different from the reader's chair. On a state
 * screen there is no date anywhere and the question is "where is the picker".
 * On Fetch a day there is a date input three inches below and the question is
 * "why can I not ask for a week".
 *
 * The lead states the GRAIN the source answers at, so a source bounded to a
 * month adds a key here rather than a free-text lead at the call site.
 */
const LEAD = {
  state: 'No date range.',
  source: 'One day at a time.',
} as const

export default function WhyNoRange({ why, what }: { why: keyof typeof LEAD; what: string }) {
  return (
    <p className="mb-3 text-xs text-stone-500">
      <span className="font-medium text-stone-600">{LEAD[why]}</span> {what}
    </p>
  )
}
