import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getSalesSeries, getYesterday, getUnmappedSummary, getMissingCloses } from '@/server/dashboard-queries'
import { getSalesDays } from '@/server/sales-queries'
import { getGstServiceByDay } from '@/server/reports-queries'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { requires } from '@/lib/precondition'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import {
  cardCls, heroNumCls, pageSubCls, pageTitleCls, sectionHeadCls,
} from '@/components/ui'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { SalesLine } from '@/components/dashboard/Charts'
import Honesty from '@/components/Honesty'
import Unassessed, { unassessedToneCls } from '@/components/dashboard/Unassessed'
import GroupDiagnostics from '@/components/dashboard/Diagnostics'
import MyQueriesPanel from '@/components/accountant/MyQueriesPanel'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

// The cashier's own dashboard. Day close moved into Record — it is a daily
// money event like the vouchers beside it — so this tab is now what the
// cashier looks at rather than what they type into.
//
// EVERY CARD HERE DECLARES WHAT IT RESTS ON. Three of the four divide by sales
// one way or another, and with nothing fetched they used to report a clean
// mapping queue, a dash for the tax rate and a drawer note — three answers
// over an empty set. They now say what is missing instead.
//
// The order down the page is the ranking law spelled out in DOM order: real
// findings (the accountant's questions, then the books' own) sit above
// everything measured, and a card that cannot be assessed says so where it
// stands rather than being promoted or hidden.

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

export default async function SalesDashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  // ONE front door for ?period=, so preset/custom precedence is decided in
  // one place rather than in twelve hand-written ternaries.
  const periodToday = await businessToday()
  const periodReq = readPeriodParam(periodParam, periodToday)
  const period = resolvePeriod(periodReq.param, periodToday)
  const restaurant = await getRestaurant()

  const [series, yesterday, unmapped, missing, gst, everFetched] = await Promise.all([
    getSalesSeries(restaurant.id, period.from, period.to),
    getYesterday(restaurant.id),
    getUnmappedSummary(restaurant.id, period.from, period.to),
    getMissingCloses(restaurant.id, period.from, period.to),
    getGstServiceByDay(restaurant.id, period.from, period.to),
    // one row is all this asks: has a POS day EVER been fetched. The mapping
    // queue is all-time, so its precondition has to be too.
    getSalesDays(restaurant.id, 1),
  ])

  const total = series.reduce((n, p) => n + decimalStringToPaise(p.revenue), 0)
  const diff = yesterday.difference === null ? null : decimalStringToPaise(yesterday.difference)
  const foodBev = gst.reduce((n, r) => n + decimalStringToPaise(r.food_bev), 0)
  const gstTotal = gst.reduce((n, r) => n + decimalStringToPaise(r.gst_collected), 0)

  const revenue = requires(
    series.length > 0,
    series,
    'no day fetched',
    'No sales day has been fetched for this period. Every figure below that divides by sales stays blank until one is — the app will not guess a denominator.',
  )

  // GST collected ÷ what was actually sold. Nothing sold is not a 0% rate and
  // not a dash either; it is no rate at all. The ratio is only read on the
  // assessable branch, which is why the divisor can never be zero here.
  const gstRate = requires(
    foodBev > 0,
    foodBev > 0 ? (gstTotal / foodBev) * 100 : 0,
    'no base to tax',
    'No food or drink was sold in this period, so there is nothing GST could have been charged on. An effective rate needs something underneath it.',
  )

  const drawer = requires(
    diff !== null,
    diff ?? 0,
    'not closed yet',
    `${fmtDate(yesterday.date)} has no cash close, so whether the drawer squared is not known. That is different from it having squared.`,
  )

  // THE REPORTED BUG. "Everything sold is mapped to a dish" was true of an
  // empty queue and read as an all-clear on a restaurant that has never
  // fetched a day.
  const mapping = requires(
    everFetched.length > 0,
    unmapped,
    'nothing ever sold',
    // says what was CHECKED, not what was guessed: sales_by_day carries a row
    // for any order of any status, so no row means no order was ever recorded.
    // A fetch that came back to a closed day leaves a pos_fetches row and no
    // sales — telling the cashier nothing was ever fetched would be this same
    // bug one level down.
    'No POS sale has ever been recorded, so there is nothing for a dish to claim. An empty mapping queue here is an empty queue, not a complete one.',
  )

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Sales</h1>
        <p className={pageSubCls}>{restaurant.name} — {period.label}</p>
      </header>

      {/* What the accountant is asking THIS role, on the screen they already
          open every morning. Renders nothing when nothing is asked. */}
      <div className="pb-4">
        <MyQueriesPanel />
      </div>

      {/* The books' own diagnostics, routed here because the cashier is the
          only person who can close a day. This replaced a hand-rolled card
          reading the same view: the fact now reaches the cashier and the
          accountant in one voice, and the dates ride along as `detail`
          because a count alone does not tell you which nights to go and
          count. Period-independent, so it sits above the period control. */}
      <div className="pb-4">
        <GroupDiagnostics
          restaurantId={restaurant.id}
          group="sales"
          extra={{
            'Days with sales but no cash close': {
              detail: missing.length === 0 ? undefined : missing.slice(0, 5).map((d) => fmtDate(d)).join(' · '),
              action: { href: '/sales/record/close', label: 'Close a day' },
            },
          }}
        />
      </div>

      <div className="pb-4">
        <PeriodControl period={period} error={periodReq.error} basePath="/sales" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className={`${cardCls} ${revenue.assessable ? '' : unassessedToneCls}`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Revenue</h2>
            <span className="font-mono text-[10px] text-stone-400">sales_by_day</span>
          </div>
          {!revenue.assessable ? (
            <>
              <p className="mt-1.5 text-sm text-stone-600">{revenue.why}</p>
              <div className="mt-2">
                <Unassessed needs={revenue.needs} />
              </div>
              <Link
                href="/sales/books/fetch"
                className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline"
              >
                fetch a day →
              </Link>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-stone-700">
                {formatPaise(total)} across {revenue.data.length} {plural(revenue.data.length, 'day')}.
              </p>
              {revenue.data.length === 1 ? (
                <p className={`mt-1 text-[26px] ${heroNumCls} text-stone-900`}>
                  {formatMoneyString(revenue.data[0].revenue)}
                </p>
              ) : (
                <div className="mt-2">
                  <SalesLine points={revenue.data} />
                </div>
              )}
            </>
          )}
        </section>

        <section className={`${cardCls} ${drawer.assessable ? '' : unassessedToneCls}`}>
          <h2 className={sectionHeadCls}>Yesterday&apos;s drawer</h2>
          {!drawer.assessable ? (
            <>
              <p className="mt-1.5 text-sm text-stone-600">{drawer.why}</p>
              <div className="mt-2">
                <Unassessed needs={drawer.needs} />
              </div>
              <Link
                href="/sales/record/close"
                className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline"
              >
                close a day →
              </Link>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-stone-700">
                {drawer.data === 0
                  ? `${fmtDate(yesterday.date)} squared exactly.`
                  : `${fmtDate(yesterday.date)} was out by ${formatPaise(Math.abs(drawer.data))}.`}
              </p>
              {drawer.data !== 0 && (
                <p className={`mt-1 text-[26px] ${heroNumCls} text-red-700`}>{formatPaise(drawer.data)}</p>
              )}
              <Link
                href="/sales/record/close"
                className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline"
              >
                close a day →
              </Link>
            </>
          )}
        </section>

        <section className={`${cardCls} ${gstRate.assessable ? '' : unassessedToneCls}`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Effective GST</h2>
            <span className="font-mono text-[10px] text-stone-400">gst_service_by_day</span>
          </div>
          {!gstRate.assessable ? (
            <>
              <p className="mt-1.5 text-sm text-stone-600">{gstRate.why}</p>
              <div className="mt-2">
                <Unassessed needs={gstRate.needs} />
              </div>
            </>
          ) : (
            <>
              <p className={`mt-1 text-[26px] ${heroNumCls} text-stone-900`}>{gstRate.data.toFixed(2)}%</p>
              <p className="text-xs text-stone-600">
                GST belongs to the government, service charge to the staff — neither is revenue.
              </p>
              <Link
                href="/sales/books/gst"
                className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline"
              >
                the reconciliation →
              </Link>
            </>
          )}
        </section>

        <section className={`${cardCls} ${mapping.assessable ? '' : unassessedToneCls}`}>
          <h2 className={sectionHeadCls}>Unmapped POS revenue</h2>
          {!mapping.assessable ? (
            <>
              <p className="mt-1.5 text-sm text-stone-600">{mapping.why}</p>
              <div className="mt-2">
                <Unassessed needs={mapping.needs} />
              </div>
              <Link
                href="/sales/books/fetch"
                className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline"
              >
                fetch a day →
              </Link>
            </>
          ) : mapping.data.items === 0 ? (
            <p className="mt-1.5 text-sm text-stone-700">Everything sold is mapped to a dish.</p>
          ) : (
            <>
              <p className={`mt-1 text-[26px] ${heroNumCls} text-red-700`}>
                {formatMoneyString(mapping.data.revenue)}
              </p>
              <div className="mt-2">
                <Honesty level="alarm" verdict="unclaimed" compact>
                  {mapping.data.items} POS {plural(mapping.data.items, 'item')} no dish claims, so this money
                  belongs to no department and no food cost.
                </Honesty>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  )
}
