/**
 * WHERE A PERIOD CONTROL WOULD SIT, ON A SCREEN THAT HAS NO PERIOD.
 *
 * A date range answers WHAT HAPPENED BETWEEN THESE DATES. Some screens answer
 * WHAT IS HERE NOW, and putting a picker on one of those promises the figure
 * moves when the dates do. It does not — `stock_on_hand`, `supplier_costs` and
 * `vendor_performance` contain no date reference at all, verified against
 * information_schema rather than assumed.
 *
 *   A CONTROL THAT CANNOT CHANGE THE ANSWER IS A LIE BY AFFORDANCE.
 *
 * So the control is absent AND the absence is explained, in the place the
 * control would have been. A tab with neither is the state this fixes: the
 * reader cannot tell "this ignores dates" from "somebody forgot the picker".
 */
export default function AsItStands({ what }: { what: string }) {
  return (
    <p className="mb-3 text-xs text-stone-500">
      <span className="font-medium text-stone-600">No date range.</span> {what}
    </p>
  )
}
