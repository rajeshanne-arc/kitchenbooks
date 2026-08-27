// ONE FACT ABOUT THE REGISTER, SAID ONCE, WITH FOUR TAILS.
//
// Nothing has ever left this store. 330 bills in and nothing out, which makes
// every figure downstream a running total of PURCHASES rather than a stock
// position — and that one sentence explains four different screens.
//
// AMBER, NOT RED. Nothing is wrong: a register with one side is exactly what a
// restaurant that has not started issuing looks like. Red would say somebody
// made a mistake.
//
// THE CONDITION IS ALL-TIME, never period-scoped. The claim is about the books,
// not about a month, and it clears itself the day one issue is saved — no
// toggle, no setting, no constant to remember to remove.
//
// It renders ABOVE the number it qualifies. The qualification arrives first
// because the number is what is being qualified; underneath, it reads as a
// footnote to a figure the reader has already believed.

import { fmtDate } from '@/lib/format'

/** Which screen this is, and therefore what the fact means HERE. The Count
 *  screen is deliberately absent: its thin-history block already says this
 *  better, and a second sentence beside it would be two voices. */
export type IssuedTail = 'on-hand' | 'reorder' | 'loss'

const TAILS: Record<IssuedTail, React.ReactNode> = {
  'on-hand': (
    <>
      …so the 87% of this page marked never issued is <b>one fact about the register</b>, not two hundred
      facts about items.
    </>
  ),
  reorder: (
    <>
      …so no item has any consumption behind it, and a level set today would be a guess. One item shows
      below because one item of 358 carries a level — <b>that is not good news</b>.
    </>
  ),
  loss: (
    <>
      …so wastage recorded here will be <b>the only thing reducing the book</b>. Record it anyway; it is
      still true, and it is the one movement out that exists.
    </>
  ),
}

export default function NothingIssued({
  tail,
  since,
  bills,
}: {
  tail: IssuedTail
  /** the day the books open — the opening count, not the first bill */
  since: string
  bills: number
}) {
  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50/70 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2">
        <span aria-hidden className="h-[11px] w-[11px] shrink-0 rounded-[2px] border border-amber-400 bg-white" />
        <span className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-amber-800">
          Nothing issued
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-amber-900">
        No stock has left the store since {fmtDate(since)}. {bills} bills in, nothing out — a running total
        of purchases, not a stock position. {TAILS[tail]}
      </p>
    </div>
  )
}
