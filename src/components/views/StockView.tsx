import Link from 'next/link'
import { Suspense } from 'react'
import FilterInput from '@/components/books/FilterInput'
import { RetiredBadge } from '@/components/books/Badges'
import { getRestaurant } from '@/server/queries'
import { listStock, stockTotalValue } from '@/server/store-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import Honesty, { HonestyPill } from '@/components/Honesty'
import { cardCls, sectionHeadCls } from '@/components/ui'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import type { StockRow } from '@/lib/types'
import { AbcBadge } from '@/components/stock/Abc'

/**
 * STOCK ON HAND — the owner's monthly question: what is it worth.
 *
 * A STOCK SCREEN IS NOT ONE JOB, and every mediocre inventory UI is one screen
 * trying to be three. This one answers value; Reorder answers what to buy and
 * groups by VENDOR because an order goes to a vendor; Count answers what is
 * physically there and walks by LOCATION. Same table, three orderings, three
 * screens.
 *
 * Grouped by CATEGORY because that is how inventory is presented in every
 * accounting standard — the grouping is not a preference, it is the shape the
 * reader already knows. Value orders within each group.
 *
 * Mounted in two groups — the chef reads it, the store owns it.
 */

/** Days of cover, or the reason there is no answer. NEVER a number below
 *  seven days of history: one issue makes max = min, and the average would
 *  read the whole quantity as a single day's usage. */
function Cover({ row }: { row: StockRow }) {
  if (row.days_on_hand === null) {
    return (
      <span className="text-stone-400" title="Needs at least 7 days of issue history before an average means anything">
        {row.days_of_history === null ? 'never issued' : 'not enough history'}
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

export default async function StockView({ q = '' }: { q?: string }) {
  const restaurant = await getRestaurant()
  // LAW 1: the chef reads this page but owns neither the item master nor the
  // bill screen, so those links are not painted for them — the numbers still
  // are. A name that is not a link is not a dead end; it is honest.
  const user = await getSessionUser()
  const canOpenItems = user !== null && canAccess(user.role, '/store/masters/items')
  const canEnterBill = user !== null && canAccess(user.role, '/store/receive/purchase')
  const [rows, total] = await Promise.all([listStock(restaurant.id, q.slice(0, 60)), stockTotalValue(restaurant.id)])

  const totalPaise = decimalStringToPaise(total)

  // The query already orders category → value, so grouping is a fold rather
  // than a sort: the view's ordering survives to the screen untouched.
  const groups: { category: string; rows: StockRow[]; value: number }[] = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    const v = decimalStringToPaise(r.on_hand_value)
    if (last && last.category === r.category_name) {
      last.rows.push(r)
      last.value += v
    } else groups.push({ category: r.category_name, rows: [r], value: v })
  }

  // BOUGHT AND NEVER ISSUED — computed from the ledger, never asserted, and
  // deliberately not gas-specific: it will catch the next one too. Four gas
  // cylinders at ₹12,100 are 26% of this store's value and have never reached
  // a department's consumption; grouping must not bury that.
  const neverIssued = rows.filter((r) => Number(r.issued_qty) === 0 && Number(r.purchased_qty) > 0)
  const neverIssuedPaise = neverIssued.reduce((n, r) => n + decimalStringToPaise(r.on_hand_value), 0)

  return (
    <section>
      <div className={`${cardCls} mt-4`}>
        <div className="flex items-baseline justify-between gap-3">
          <span className={sectionHeadCls}>Stock value on hand</span>
          <span className="text-2xl font-bold tabular-nums tracking-tight text-stone-900">
            {formatMoneyString(total)}
          </span>
        </div>
        <p className="mt-1 text-xs text-stone-400">
          purchases in, issues and wastage out, at weighted-average cost · stock_on_hand · stock_abc
        </p>
      </div>

      {neverIssued.length > 0 && totalPaise > 0 && (
        <div className="mt-3">
          <Honesty level="alarm" verdict="bought, never issued">
            {neverIssued.map((r) => r.name).join(', ')} —{' '}
            {formatMoneyString(String(neverIssuedPaise / 100))}, {Math.round((neverIssuedPaise / totalPaise) * 100)}%
            of everything on this page — {neverIssued.length === 1 ? 'has' : 'have'} been bought and never issued to
            any department. That value is sitting on the shelf rather than in anybody&apos;s food cost, and no count
            has ever contradicted it.
          </Honesty>
        </div>
      )}

      <Suspense>
        <FilterInput placeholder="Filter stock by item name or code" />
      </Suspense>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
          {q !== '' ? (
            <p className="text-sm text-stone-500">No stock row matches “{q}”.</p>
          ) : (
            <>
              <p className="text-lg font-semibold text-stone-900">Nothing on hand yet.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
                Stock builds from purchase bills, falls with issues and wastage — enter a bill and this page comes
                alive.
              </p>
              {canEnterBill && (
                <Link
                  href="/store/receive/purchase"
                  className="mt-5 inline-block rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  Enter a bill
                </Link>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((g) => {
            const share = totalPaise > 0 ? (g.value / totalPaise) * 100 : 0
            return (
              <section key={g.category} className={cardCls}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className={sectionHeadCls}>{g.category}</h3>
                  <span className="shrink-0 text-right">
                    <span className="font-mono text-[15px] font-bold tabular-nums text-stone-900">
                      {formatMoneyString(String(g.value / 100))}
                    </span>
                    <span className="ml-2 font-mono text-[11px] tabular-nums text-stone-400">
                      {share.toFixed(1)}%
                    </span>
                  </span>
                </div>
                {/* the share of total value, as a bar. Not decoration: it is
                    the answer to "what is it worth" at a glance. */}
                <div
                  className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-100"
                  role="img"
                  aria-label={`${g.category} is ${share.toFixed(1)}% of stock value`}
                >
                  <div className="h-full rounded-full bg-emerald-700" style={{ width: `${Math.max(share, 0.5)}%` }} />
                </div>

                <ul className="mt-1 divide-y divide-rule-soft">
                  {g.rows.map((r) => {
                    const negative = Number(r.on_hand_qty) < 0
                    return (
                      <li key={r.item_id} className={r.status === 'inactive' ? 'opacity-60' : ''}>
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
                                {Number(r.issued_qty) === 0 && Number(r.purchased_qty) > 0 && (
                                  <HonestyPill level="alarm">never issued</HonestyPill>
                                )}
                              </div>
                              <div className="mt-0.5 text-xs text-stone-500">
                                <span className="font-mono">{r.code}</span> · <Cover row={r} />
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
                              <div
                                className={`text-[15px] font-bold tabular-nums ${
                                  negative ? 'text-red-700' : 'text-stone-900'
                                }`}
                              >
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
                                More has been issued than was ever bought on record. Stock cannot go below zero — a
                                bill is missing.
                              </Honesty>
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
          <p className="px-1 text-xs text-stone-400">
            A, B and C are shares of value, not judgements about items: roughly the few things carrying most of the
            money, the middle, and the long tail. They set how often each is counted — weekly, fortnightly, monthly.
          </p>
        </div>
      )}
    </section>
  )
}
