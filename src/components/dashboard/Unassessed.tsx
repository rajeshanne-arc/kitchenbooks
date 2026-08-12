// The third state, drawn.
//
// A dashboard card is not pass/fail. It is pass, fail, or CANNOT BE ASSESSED,
// and the third has to be as visible as the other two — "we do not know" is a
// finding, not the absence of one. `src/lib/precondition.ts` decides WHEN a
// card is in this state; this file is what that looks like.
//
// Why stone and not a colour: red says something is wrong and amber says a
// number is standing on soft ground. Neither is true here. Nothing has been
// found wrong and no figure has been stated at all — the question simply
// cannot be answered yet. So the card borrows the one mark this app already
// uses for truth still owed: the blank spreadsheet cell from the honesty
// meter, in the muted end of the sheet's own neutrals, dashed rather than
// hatched so it can never be mistaken for doubt from across the room.

/** Card tone for an unassessable card. Pass to the dashboard's Card so every
 *  group's dashboard wears the same third state. */
export const unassessedToneCls = 'border-dashed border-stone-300 bg-stone-100/70 hover:border-stone-400'

/** The emblem: a cell nobody has been able to fill. */
function BlankCell() {
  return (
    <span
      aria-hidden
      className="h-[11px] w-[11px] shrink-0 rounded-[2px] border border-dashed border-stone-400 bg-cell"
    />
  )
}

/**
 * The strip. `needs` is the missing thing in three or four words — "no sales
 * day fetched" — and it sits beside the verdict so the reason is read in the
 * same glance as the state. `children` is optional follow-up: where to go and
 * enter the thing that is missing.
 *
 * Never put a link in here. These strips live inside cards that are
 * themselves links, and a link inside a link is invalid.
 */
export default function Unassessed({ needs, children }: { needs: string; children?: React.ReactNode }) {
  return (
    <div role="note" className="rounded-xl border border-dashed border-stone-300 bg-cell px-2.5 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="self-center">
          <BlankCell />
        </span>
        <span className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-stone-500">
          cannot be assessed
        </span>
        <span className="text-[11.5px] text-stone-500">{needs}</span>
      </div>
      {/* a div, not a p: a caller's follow-up may be a list of the things that
          are missing, and a ul inside a p is invalid and unmounts the list */}
      {children !== undefined && (
        <div className="mt-1.5 text-[13px] leading-snug text-stone-600">{children}</div>
      )}
    </div>
  )
}
