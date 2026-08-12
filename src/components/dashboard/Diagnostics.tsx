// Diagnostics live where they are READ, not where they are fixed.
//
// books_completeness has always known that days sold food and were never
// closed. It said so on the accountant's Review — to the one person in the
// building who cannot close a day. The cashier, who can, saw a card about
// yesterday's drawer and nothing else.
//
// So the view is untouched (it is the single source, and Review stays the
// reviewer's copy of every row) and the SAME rows are routed to the group home
// of whoever can act on them. One fact, two readers, phrased for each.
//
// Renders NOTHING when this group has nothing to answer for. A permanent
// "diagnostics: 0" panel is a thing to read and dismiss every morning.

import { getBooksCompleteness } from '@/server/accountant-queries'
import Honesty, { type HonestyLevel } from '@/components/Honesty'
import { cardCls, sectionHeadCls } from '@/components/ui'

export type DiagGroup = 'kitchen' | 'store' | 'sales' | 'owner'

/** Who can act on each row the view publishes.
 *
 *  Keyed on the view's own wording, because the view owns the wording — this
 *  file decides WHO reads a row, never what it says. A row whose text is not
 *  here has no home yet and loses nothing by it: Review renders every row
 *  verbatim, so an unrouted row is still seen. Routing one to the wrong desk
 *  is the expensive mistake, not leaving one unrouted. */
const ACTS_ON: Record<string, DiagGroup> = {
  // only the cashier counts a drawer and files a close
  'Days with sales but no cash close': 'sales',
  // which account the money moved through is a bookkeeping call, not a
  // counter-side one — the owner and the accountant are the two who can name it
  'Money movements with no account named': 'owner',
  // the bill number is typed by whoever enters the bill
  'Purchases with no bill number': 'store',
  // gstin is column-granted on the vendor master, which is the store's screen
  'Active vendors with no tax registration recorded': 'store',
  // 'Open queries awaiting an answer' is DELIBERATELY absent: MyQueriesPanel
  // already puts each question on its own role's home, with the answer box
  // beside it. Two copies of one question is two people assuming the other
  // answered it.
}

const LEVEL: Record<string, HonestyLevel> = { 'STOPS THE SUM': 'alarm' }

export default async function GroupDiagnostics({
  restaurantId,
  group,
  extra = {},
}: {
  restaurantId: string
  group: DiagGroup
  /** Keyed on the row's `what`. `detail` is what this screen can add that a
   *  count cannot — the actual dates, usually.
   *
   *  The href lives at the CALL SITE on purpose: one shared component holding
   *  every group's routes would put a store link in a chef's import graph,
   *  which is strict invisibility broken for convenience. A page can only ever
   *  hand over its own routes. */
  extra?: Record<string, { detail?: string; action?: { href: string; label: string } }>
}) {
  const rows = await getBooksCompleteness(restaurantId)
  const mine = rows.filter((r) => ACTS_ON[r.what] === group)
  if (mine.length === 0) return null

  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>What the books are missing from you</h2>
        <span className="font-mono text-[10px] text-stone-400">books_completeness</span>
      </div>
      <ul className="mt-2 space-y-2">
        {mine.map((r) => {
          const e = extra[r.what]
          return (
            <li key={r.what}>
              <Honesty level={LEVEL[r.severity] ?? 'pending'} verdict={r.severity} action={e?.action} compact>
                {r.what} — {r.n}
                {e?.detail !== undefined && ` · ${e.detail}`}
              </Honesty>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
