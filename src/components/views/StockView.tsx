import Link from 'next/link'
import { Suspense } from 'react'
import FilterInput from '@/components/books/FilterInput'
import { RetiredBadge } from '@/components/books/Badges'
import { getRestaurant } from '@/server/queries'
import { issueContext, listStock, stockCategoryRollup, stockTotalValue } from '@/server/store-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import Honesty from '@/components/Honesty'
import NothingIssued from '@/components/stock/NothingIssued'
import ViewToggle from '@/components/ViewToggle'
import { cardCls, sectionHeadCls } from '@/components/ui'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import type { CategoryRollupRow, StockRow, StockView as StockViewMode } from '@/lib/types'
import { AbcBadge } from '@/components/stock/Abc'

/**
 * STOCK ON HAND — the owner's monthly question: what is it worth.
 *
 * A STOCK SCREEN IS NOT ONE JOB, and every mediocre inventory UI is one screen
 * trying to be three. This one answers value; Reorder answers what to buy and
 * groups by VENDOR because an order goes to a vendor; Count answers what is
 * physically there and walks by LOCATION. Same table, three orderings, three
 * SCREENS — which is why there are only TWO options in the toggle below and no
 * "by shelf": that would duplicate Count inside On hand, and two answers to one
 * question is the fault this codebase keeps removing.
 *
 * Mounted in two groups — the chef reads it, the store owns it.
 */

const VIEWS = [
  {
    value: 'by-category' as const,
    label: 'By category',
    hint: 'Grouped with subtotals — how inventory is presented in every accounting standard.',
  },
  {
    value: 'by-value' as const,
    label: 'By value',
    hint: 'One flat list, biggest holding first — the question grouping hides.',
  },
]

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

/**
 * ONE ROW DEFINITION, rendered grouped and flat alike. Two copies would be two
 * places for the next change — the argument that already made AbcBadge shared.
 * `showCategory` is the only difference: inside a category card it would repeat
 * the heading, and in the flat list it is the missing context.
 */
function StockLine({
  r,
  canOpenItems,
  showCategory,
}: {
  r: StockRow
  canOpenItems: boolean
  showCategory: boolean
}) {
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

export default async function StockView({
  q = '',
  view = 'by-category',
  cat = '',
}: {
  q?: string
  view?: StockViewMode
  /** one category, tapped in the fold. A category filter and a search filter
   *  are the SAME operation — so they share one renderer and one code path
   *  rather than growing a second, foldable one, and Back returns to the
   *  summary because it is a navigation rather than an expansion. */
  cat?: string
}) {
  const restaurant = await getRestaurant()
  // LAW 1: the chef reads this page but owns neither the item master nor the
  // bill screen, so those links are not painted for them — the numbers still
  // are. A name that is not a link is not a dead end; it is honest.
  const user = await getSessionUser()
  const canOpenItems = user !== null && canAccess(user.role, '/store/masters/items')
  const canEnterBill = user !== null && canAccess(user.role, '/store/receive/purchase')

  // FILTERED OR FLAT — decided once, here. Somebody who typed "pan" wants the
  // hits, not three folded cards containing them; and by-value exists
  // precisely to defeat grouping, so it is flat always.
  const filtered = q !== '' || cat !== ''
  const flat = filtered || view === 'by-value'

  const [rows, total, rollup, ctx] = await Promise.all([
    flat ? listStock(restaurant.id, q.slice(0, 60), view, cat) : Promise.resolve([] as StockRow[]),
    stockTotalValue(restaurant.id),
    flat
      ? Promise.resolve({ rows: [] as CategoryRollupRow[], reconciles: true, cardExact: '0', rollupExact: '0' })
      : stockCategoryRollup(restaurant.id),
    issueContext(restaurant.id),
  ])

  const totalPaise = decimalStringToPaise(total)

  // ─────────────────────────────────────────────────────────────────────────
  // THE RECONCILIATION. The card totals stock_on_hand directly; the rollup
  // totals it JOINED to categories. They must agree EXACTLY, in paise — a
  // category code present on an item and absent from `categories` would drop
  // those items from the fold and leave the card untouched, and nobody sums
  // fifteen numbers by eye. Measured today: both ₹25,92,511.86, and excluding
  // one category from the join moves the rollup by ₹6,93,761.50 — caught.
  //
  // Unresolved codes land under UNCLASSIFIED rather than being dropped, so this
  // should never fire; it is here because "should never" is not a mechanism.
  // ─────────────────────────────────────────────────────────────────────────
  // Computed in SQL, at full precision — see the note on stockCategoryRollup.
  // Comparing rounded subtotals here reported a one-paise mismatch on live
  // data with nothing actually missing, because rounding is not associative.
  const reconciles = rollup.reconciles
  const rollupRows = rollup.rows

  const groupsOf = (kind: CategoryRollupRow['kind']) => rollupRows.filter((r) => r.kind === kind)
  const sumOf = (rs: CategoryRollupRow[]) => rs.reduce((n, r) => n + decimalStringToPaise(r.value), 0)
  const BANDS: { kind: CategoryRollupRow['kind']; heading: string; becomes: string }[] = [
    { kind: 'ingredient', heading: 'Ingredients', becomes: 'becomes cost of goods sold' },
    { kind: 'operational', heading: 'Operational', becomes: 'becomes operating cost' },
    // Never dropped, and never silently: an item whose category resolves to
    // nothing is a finding, not a rounding difference.
    { kind: 'unclassified', heading: 'Unclassified', becomes: 'category code matches no category' },
  ]

  return (
    <section>
      {/* THE SEARCH IS THE FIRST THING ON THE PAGE. It was fourth, so the
          storeman scrolled past three blocks to reach the one control that
          would have saved him the scrolling. */}
      <Suspense>
        <FilterInput placeholder="Filter stock by item name or code" />
      </Suspense>

      {/* ABOVE THE NUMBER IT QUALIFIES. Underneath, it reads as a footnote to a
          figure the reader has already believed. */}
      {!ctx.issued && ctx.since !== null && (
        <NothingIssued tail="on-hand" since={ctx.since} bills={ctx.bills} />
      )}

      <div className={`${cardCls} mt-3`}>
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

      {!reconciles && (
        <div className="mt-3">
          <Honesty level="alarm" verdict="these do not add up">
            The categories below total {formatMoneyString(rollup.rollupExact)} and the card says{' '}
            {formatMoneyString(rollup.cardExact)}. <b>Some items are missing from the fold.</b> The likely cause is a
            category code on an item that matches no row in the categories table — those should appear under
            Unclassified rather than vanish, so if that heading is absent the join has stopped being a LEFT
            join. Use By value, which totals the same rows without the join, until this is resolved.
          </Honesty>
        </div>
      )}

      <Suspense>
        <ViewToggle
          param="view"
          value={view}
          options={VIEWS}
          defaultValue="by-category"
          label="How to order stock on hand"
        />
      </Suspense>

      {cat !== '' && (
        <p className="mt-3 text-sm text-stone-600">
          <Link href="/store/stock/on-hand" className="font-semibold text-emerald-800 hover:underline">
            ← All categories
          </Link>
          <span className="ml-2 text-stone-500">
            {rows.length} item{rows.length === 1 ? '' : 's'} in {rows[0]?.category_name ?? cat}
          </span>
        </p>
      )}

      {flat ? (
        rows.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
            {filtered ? (
              <p className="text-sm text-stone-500">
                No stock row matches {q !== '' ? `“${q}”` : 'that category'}.
              </p>
            ) : (
              <>
                <p className="text-lg font-semibold text-stone-900">Nothing on hand yet.</p>
                <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
                  Stock builds from purchase bills, falls with issues and wastage — enter a bill and this
                  page comes alive.
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
          <section className={`${cardCls} mt-3`}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className={sectionHeadCls}>
                {filtered ? 'Matching items' : 'Biggest holdings first'}
              </h3>
              <span className="font-mono text-[11px] text-stone-400">{rows.length} items</span>
            </div>
            <ul className="mt-1 divide-y divide-rule-soft">
              {rows.map((r) => (
                <StockLine key={r.item_id} r={r} canOpenItems={canOpenItems} showCategory />
              ))}
            </ul>
          </section>
        )
      ) : (
        <div className="mt-3 space-y-4">
          {BANDS.map(({ kind, heading, becomes }) => {
            const band = groupsOf(kind)
            if (band.length === 0) return null
            const bandPaise = sumOf(band)
            const bandShare = totalPaise > 0 ? (bandPaise / totalPaise) * 100 : 0
            return (
              <div key={kind}>
                {/* NOT COLLAPSIBLE. Fifteen rows is one screen; folding it
                    would hide what already fits and charge a click for every
                    lookup, forever. */}
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h3 className={sectionHeadCls}>
                    {heading}
                    <span className="ml-2 font-sans text-[11px] font-normal normal-case tracking-normal text-stone-500">
                      {becomes}
                    </span>
                  </h3>
                  <span className="shrink-0 text-right">
                    <span className="font-mono text-[15px] font-bold tabular-nums text-stone-900">
                      {formatMoneyString(String(bandPaise / 100))}
                    </span>
                    <span className="ml-2 font-mono text-[11px] tabular-nums text-stone-400">
                      {bandShare.toFixed(1)}%
                    </span>
                  </span>
                </div>

                <ul className="mt-1.5 divide-y divide-rule-soft overflow-hidden rounded-2xl border border-rule bg-cell">
                  {band.map((g) => {
                    // ONE DENOMINATOR THROUGHOUT — every percentage is against
                    // the whole ₹25.9L, so a row and a heading never need
                    // explaining against each other.
                    const share = totalPaise > 0 ? (decimalStringToPaise(g.value) / totalPaise) * 100 : 0
                    return (
                      <li key={g.category || 'unclassified'}>
                        <Link
                          href={`?cat=${encodeURIComponent(g.category)}`}
                          className="block px-4 py-3 hover:bg-stone-50"
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate text-[15px] font-medium text-stone-900">
                              <span aria-hidden className="mr-1.5 text-stone-400">
                                ›
                              </span>
                              {g.category_name}
                              <span className="ml-2 text-xs font-normal text-stone-500">
                                {g.items} item{g.items === 1 ? '' : 's'}
                              </span>
                              {/* A FOLDED CATEGORY CANNOT HIDE A NEGATIVE.
                                  Unexercised today — negative stock needs
                                  issues exceeding purchases and there are no
                                  issues at all — so this path has never
                                  rendered against real data. */}
                              {g.negatives > 0 && (
                                <span className="ml-2 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                                  {g.negatives} negative
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="font-mono text-[15px] font-bold tabular-nums text-stone-900">
                                {formatMoneyString(g.value)}
                              </span>
                              <span className="ml-2 font-mono text-[11px] tabular-nums text-stone-400">
                                {share.toFixed(1)}%
                              </span>
                            </span>
                          </div>
                          <div
                            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-100"
                            role="img"
                            aria-label={`${g.category_name} is ${share.toFixed(1)}% of stock value`}
                          >
                            <div
                              className="h-full rounded-full bg-emerald-700"
                              style={{ width: `${Math.max(share, 0.5)}%` }}
                            />
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      {(rows.length > 0 || rollupRows.length > 0) && (
        <p className="mt-3 px-1 text-xs text-stone-400">
          A, B and C are shares of value, not judgements about items: roughly the few things carrying most of
          the money, the middle, and the long tail. They set how often each is counted — weekly, fortnightly,
          monthly.
        </p>
      )}
    </section>
  )
}
