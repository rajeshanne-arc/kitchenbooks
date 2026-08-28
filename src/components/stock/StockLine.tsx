import Link from 'next/link'
import { formatMoneyString } from '@/lib/money'
import { RetiredBadge } from '@/components/books/Badges'
import { AbcBadge } from '@/components/stock/Abc'
import Honesty from '@/components/Honesty'
import { canAccess, type Role } from '@/lib/roles'
import type { StockRow } from '@/lib/types'

// ONE DEFINITION. The flat list renders these and so does an expanded
// category; two copies of a stock row is how they drift.
/**
 * ONE ROW DEFINITION, rendered grouped and flat alike. Two copies would be two
 * places for the next change — the argument that already made AbcBadge shared.
 * `showCategory` is the only difference: inside a category card it would repeat
 * the heading, and in the flat list it is the missing context.
 */
export default function StockLine({
  r,
  role,
  showCategory,
}: {
  r: StockRow
  /** THE MATRIX IS ASKED HERE, not handed a boolean. This file holds the only
   *  literal /store/masters/items href reachable from the kitchen books, and a
   *  caller passing `canOpenItems` by mistake would leak it to a chef —
   *  `canAccess` cannot be got wrong that way. It is also what makes the gate
   *  VISIBLE: audit:matrix marks an href gated only when the file holding it
   *  consults the matrix, and it caught this the moment the literal moved out
   *  of StockView. Same shape as DateLink, and for the same reason: this
   *  component gates a link to a page the reader may not be able to open. */
  role: Role
  showCategory: boolean
}) {
  const canOpenItems = canAccess(role, '/store/masters/items')
  const negative = Number(r.on_hand_qty) < 0
  return (
    <li className={r.status === 'inactive' ? 'opacity-60' : ''}>
      <div className="py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <AbcBadge abc={r.abc} />
              {canOpenItems ? (
                <Link
                  href={`/store/masters/items/${r.item_id}`}
                  className="truncate text-[15px] font-medium text-stone-900 hover:underline"
                >
                  {r.name}
                </Link>
              ) : (
                <span className="truncate text-[15px] font-medium text-stone-900">{r.name}</span>
              )}
              {r.status === 'inactive' && <RetiredBadge />}
            </div>
            <div className="mt-0.5 text-xs text-stone-500">
              <span className="font-mono">{r.code}</span>
              {showCategory && <> · {r.category_name}</>} · <Cover row={r} />
              {r.issue_cost !== null && (
                <>
                  {' '}
                  · avg {formatMoneyString(r.issue_cost)}/{r.purchase_unit}
                </>
              )}
              {r.pct_of_value !== null && <> · {r.pct_of_value}% of stock value</>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className={`text-[15px] font-bold tabular-nums ${negative ? 'text-red-700' : 'text-stone-900'}`}>
              {r.on_hand_qty} {r.purchase_unit}
            </div>
            <div className={`text-xs tabular-nums ${negative ? 'text-red-600' : 'text-stone-500'}`}>
              {formatMoneyString(r.on_hand_value)}
            </div>
          </div>
        </div>
        {negative && (
          <div className="mt-2">
            <Honesty level="alarm" verdict="impossible" compact>
              More has been issued than was ever bought on record. Stock cannot go below zero — a bill is
              missing.
            </Honesty>
          </div>
        )}
      </div>
    </li>
  )
}

/** Days of cover, or the reason there is no answer. NEVER a number below
 *  seven days of history: one issue makes max = min, and the average would
 *  read the whole quantity as a single day's usage. */
function Cover({ row }: { row: StockRow }) {
  if (row.days_on_hand === null) {
    return (
      <span className="text-stone-400" title="Needs at least 7 days of issue history before an average means anything">
        {row.days_of_history === null ? 'no issue history' : 'not enough history'}
      </span>
    )
  }
  const d = Number(row.days_on_hand)
  const tone = d < 3 ? 'text-red-700 font-semibold' : d < 7 ? 'text-doubt' : 'text-stone-600'
  return (
    <span className={tone} title={`${row.days_of_history} days of issue history behind this`}>
      {d < 10 ? d.toFixed(1) : Math.round(d)} days
    </span>
  )
}
