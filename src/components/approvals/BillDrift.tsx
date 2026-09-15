// WHAT WAS ASKED FOR, AND WHAT THOSE BILLS COME TO NOW.
//
// The label under the name is AS AT ASKING and never moves — it describes the
// request. This is the other half, and it is a different claim: the same bills,
// priced today. A bill inside the range can be voided or settled between
// approval and payment, and nothing about the request changes when it is.
//
// ONLY WHEN THEY DIFFER. A drift line that is always on screen is one people
// stop reading, and with nothing moving it would say the same number twice.
// The difference is the finding, not either figure.
//
// SAID BEFORE THE BUTTON, and refused at the write. This is the courtesy half:
// `assertAmountStillCovered` recomputes it under the row lock and refuses,
// because a screen is never the check. A refusal at save is a refusal after
// the work, so the person sees it here first.
//
// COLOUR ONLY ON THE HALF THAT BLOCKS. Fewer bills than were asked for is what
// the server refuses; MORE is ordinary — a delivery landed — and colouring it
// would teach the reader that the line means trouble and then be wrong most of
// the time.

import type { RangeScope } from '@/server/approvals-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'

export default function BillDrift({
  asked,
  scope,
  from,
  to,
}: {
  /** the approved figure — null on a kind that carries none */
  asked: string | null
  /** the live total of the bills this request names; undefined when the page
   *  did not fetch one, which is NOT the same as no drift */
  scope: RangeScope | undefined
  from: string | null
  to: string | null
}) {
  if (asked === null || scope === undefined) return null
  const askPaise = decimalStringToPaise(asked)
  const nowPaise = decimalStringToPaise(scope.total)
  if (askPaise === nowPaise) return null

  const short = nowPaise < askPaise
  const what = from === null || to === null ? 'in the whole balance now' : 'in range now'

  return (
    <p
      className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
        short ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-rule bg-field text-stone-600'
      }`}
    >
      asked <span className="font-semibold tabular-nums">{formatMoneyString(asked)}</span> ·{' '}
      {what} <span className="font-semibold tabular-nums">{formatMoneyString(scope.total)}</span>
      {' · '}
      {scope.bills} {scope.bills === 1 ? 'bill' : 'bills'}
      {short && (
        <>
          {' '}
          — this cannot be paid as it stands. Send it back, or raise it again for the lower figure.
        </>
      )}
    </p>
  )
}
