// THE PARETO CLASS, and the schedule it buys.
//
// ONE DEFINITION, used by the stock list and the count sheet. The letter on a
// row is not the point — a badge tells nobody anything they can act on. The
// SCHEDULE is the point: A weekly, B fortnightly, C monthly. At a few hundred
// items that is the difference between counting happening and counting being
// theatre, so the schedule travels with the badge in its tooltip and is said
// in full on the count sheet.
//
// The classes come from `stock_abc`, which is computed and stores nothing.
// Ties break on code, so an item cannot drift between B and C because two
// equal values sorted differently on a rerun.

export const ABC_TONE: Record<string, string> = {
  A: 'border-emerald-700 bg-emerald-50 text-emerald-800',
  B: 'border-stone-300 bg-stone-100 text-stone-600',
  C: 'border-stone-200 bg-white text-stone-400',
}

export const ABC_TITLE: Record<string, string> = {
  A: 'Class A — the few items carrying most of the value. Count weekly.',
  B: 'Class B — the middle. Count fortnightly.',
  C: 'Class C — the long tail. Count monthly.',
}

/** No hooks, so it renders in a server list and a client sheet alike. */
export function AbcBadge({ abc, className = '' }: { abc: string | null; className?: string }) {
  if (abc === null || ABC_TONE[abc] === undefined) return null
  return (
    <span
      title={ABC_TITLE[abc]}
      className={`rounded border px-1 py-px font-mono text-[10px] font-semibold leading-none ${ABC_TONE[abc]} ${className}`}
    >
      {abc}
    </span>
  )
}
