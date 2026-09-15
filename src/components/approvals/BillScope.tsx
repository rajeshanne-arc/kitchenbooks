// WHICH BILLS A REQUEST IS ABOUT — one sentence, on every screen that shows a
// payment request.
//
// FIVE MOUNTS, ONE DEFINITION. The owner's approval card, the accountant's
// routed queue, "out with somebody else", "already decided" and "what happened
// to yours" all answer the same question about the same row, and five
// hand-written versions of it is how one of them comes to say something the
// others do not.
//
// A NULL PAIR IS NOT A BLANK. Three payment requests on these books predate
// the range and every non-payment request has none by construction — and a
// request that names no range is not a request about nothing, it is a claim on
// the WHOLE BALANCE, which is exactly what a payment request meant before it
// could say otherwise. Rendering that as an absence would lose the one fact
// the reader needs to compare it with the ranged one beside it.
//
// THE COUNT IS AS AT ASKING, NOT LIVE, and the difference matters on a paid
// request. A live count over a settled range reads ZERO — "bills 1–14 Aug · 0
// bills" on a request that paid all of them — which is a confident wrong
// number about history. What this line describes is the REQUEST, and a request
// is fixed at the moment it was raised. The live figure is a different claim
// and belongs where it is labelled as one.

import { readObject } from '@/lib/read-object'
import { fmtRange } from '@/lib/format'

export default function BillScope({
  kind,
  from,
  to,
  snapshot,
  className = 'text-stone-500',
}: {
  /** ONLY A PAYMENT IS ABOUT BILLS. A discard and a merge carry a null pair by
   *  construction, and "whole balance" on a discard would be nonsense — so the
   *  guard lives HERE rather than at five call sites, where the fifth one
   *  forgets. */
  kind: string
  from: string | null
  to: string | null
  /** the raise-time snapshot; `askedRangeBills` is written by every ranged
   *  request, so on a ranged row its absence is a FAULT rather than a gap */
  snapshot: unknown
  className?: string
}) {
  if (kind !== 'payment') return null

  if (from === null || to === null) {
    return (
      <span className={className} title="Raised before a request could name a range">
        whole balance
      </span>
    )
  }

  const read = readObject<{ askedRangeBills?: number }>(snapshot)
  const n = read.state === 'ok' ? read.value.askedRangeBills : undefined

  return (
    <span className={className}>
      bills {fmtRange(from, to)}
      {typeof n === 'number' ? (
        <> · {n} {n === 1 ? 'bill' : 'bills'}</>
      ) : (
        // A RANGED REQUEST ALWAYS WROTE ITS COUNT. So nothing here is the read
        // failing, not the count being absent — said quietly rather than
        // dropped, because a missing count that looks like a design choice is
        // how a broken read hides behind an honest-looking line.
        <span className="text-red-800"> · bill count will not read</span>
      )}
    </span>
  )
}
