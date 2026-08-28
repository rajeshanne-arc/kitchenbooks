import Link from 'next/link'
import { Suspense } from 'react'
import FilterInput from '@/components/books/FilterInput'
import { getRestaurant } from '@/server/queries'
import { issueContext, listStock, stockCategoryRollup, stockTotalValue } from '@/server/store-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import Honesty from '@/components/Honesty'
import StockLine from '@/components/stock/StockLine'
import StockCategories from '@/components/stock/StockCategories'
import NothingIssued from '@/components/stock/NothingIssued'
import ViewToggle from '@/components/ViewToggle'
import { cardCls, sectionHeadCls } from '@/components/ui'
import { getSessionUser } from '@/server/current-user'
import { canAccess, type Role } from '@/lib/roles'
import type { CategoryRollupRow, StockView as StockViewMode } from '@/lib/types'
import { chipHref } from '@/lib/routes'

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
  // The stock rows ask the matrix themselves (see StockLine) — this only has
  // to say WHO is reading. A signed-out reader never reaches this page; the
  // narrowest role is the safe answer if one somehow does.
  const role: Role = user?.role ?? 'chef'
  const canEnterBill = user !== null && canAccess(user.role, '/store/purchasing/receive')

  // FILTERED OR FLAT — decided once, here. Somebody who typed "pan" wants the
  // hits, not three folded cards containing them; and by-value exists
  // precisely to defeat grouping, so it is flat always.
  const filtered = q !== '' || cat !== ''
  const flat = filtered || view === 'by-value'

  // THE CHILDREN HAVE TO BE ON THE PAGE FOR THE FOLD TO EXPAND IN PLACE, and
  // in the by-category view they were NOT: `rows` was deliberately empty here,
  // because the fold only ever rendered fifteen summary lines. So this branch
  // now loads them too — the same single query the by-value view already runs,
  // ordered by value, which is exactly what "top ten by value" needs.
  //
  // That is one added query on this view, and it is the price of the rule: an
  // expand that has to FETCH is worse than a link that moves you, because it
  // hangs where a link at least goes somewhere.
  const [rows, total, rollup, ctx] = await Promise.all([
    listStock(restaurant.id, q.slice(0, 60), flat ? view : 'by-value', cat),
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
          <Link href={chipHref('store', 'stock', 'on-hand')} className="font-semibold text-emerald-800 hover:underline">
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
                    href={chipHref('store', 'purchasing', 'receive')}
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
                <StockLine key={r.item_id} r={r} role={role} showCategory />
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

                <StockCategories
                  groups={band}
                  items={rows}
                  totalPaise={totalPaise}
                  role={role}
                />
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
