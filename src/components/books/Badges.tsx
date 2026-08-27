export function VoidedBadge() {
  return (
    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
      Voided
    </span>
  )
}

export function ReversalBadge() {
  return (
    <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
      ↩ Reversal
    </span>
  )
}

export function RetiredBadge() {
  return (
    <span className="rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
      Retired
    </span>
  )
}

/** RETIRED, DISCARDED AND MERGED ARE THREE DIFFERENT SENTENCES. Retired means
 *  we stopped buying it; discarded means it was never real; merged means look
 *  over there. One badge for all three would lose the only account of why a
 *  code went quiet, so each gets its own word and its own ink. */
export function DiscardedBadge() {
  return (
    <span className="rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
      Discarded
    </span>
  )
}

export function MergedBadge() {
  return (
    <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
      Merged
    </span>
  )
}

/** The one place that decides which of the four a row wears. */
export function StatusBadge({ status }: { status: string }) {
  if (status === 'inactive') return <RetiredBadge />
  if (status === 'discarded') return <DiscardedBadge />
  if (status === 'merged') return <MergedBadge />
  return null
}
