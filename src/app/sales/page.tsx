import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getSalesSeries, getYesterday, getUnmappedSummary, getMissingCloses } from '@/server/dashboard-queries'
import { getMappingCoverage, getPaymentSplit, getSalesByHour, getSalesDay, getSalesDays } from '@/server/sales-queries'
import { getGstServiceByDay } from '@/server/reports-queries'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { requires } from '@/lib/precondition'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import {
  cardCls, heroNumCls, pageSubCls, pageTitleCls, sectionHeadCls,
} from '@/components/ui'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { HourlyLine, MagnitudeBars, SalesLine } from '@/components/dashboard/Charts'
import RefreshToday from '@/components/sales/RefreshToday'
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

  const [series, yesterday, unmapped, missing, gst, everFetched, coverage, hours, split, todayRow] =
    await Promise.all([
    getSalesSeries(restaurant.id, period.from, period.to),
    getYesterday(restaurant.id),
    getUnmappedSummary(restaurant.id, period.from, period.to),
    getMissingCloses(restaurant.id, period.from, period.to),
    getGstServiceByDay(restaurant.id, period.from, period.to),
    // one row is all this asks: has a POS day EVER been fetched. The mapping
    // queue is all-time, so its precondition has to be too.
    getSalesDays(restaurant.id, 1),
    getMappingCoverage(restaurant.id),
    getSalesByHour(restaurant.id, period.from, period.to),
    getPaymentSplit(restaurant.id, period.from, period.to),
    // TODAY IS A PARTIAL DAY and is read on its own, never folded into the
    // period figures above — otherwise half a day sits beside whole ones.
    getSalesDay(restaurant.id, periodToday),
  ])

  // THE ANOMALY IS SURFACED, NOT SMOOTHED. Noon reading three times the
  // spend per head of the lunch peak is almost certainly covers under-counted
  // at opening, not a table spending three times more — which is a Petpooja
  // data-entry question worth naming rather than charting past.
  const percovers = hours.filter((h) => h.per_cover !== null).map((h) => Number(h.per_cover))
  const medianPerCover =
    percovers.length === 0 ? null : [...percovers].sort((a, b) => a - b)[Math.floor(percovers.length / 2)]
  const oddHours =
    medianPerCover === null || medianPerCover <= 0
      ? []
      : hours.filter((h) => h.per_cover !== null && Number(h.per_cover) > medianPerCover * 2.5)

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

      {/* TODAY, AND HOW STALE IT IS. Period-independent and above everything
          the period scopes: it is the one figure a cashier looks at mid-shift,
          and it must never be mistaken for a closed day. */}
      <section className={`${cardCls} mb-4`}>
        <RefreshToday
          today={periodToday}
          orders={todayRow?.orders ?? 0}
          revenue={todayRow === null ? null : todayRow.revenue}
          lastFetchedAt={todayRow?.last_fetched_at ?? null}
        />
      </section>

      {/* THE MAPPING QUEUE AS AN ACTION CARD. Every department view in the app
          is fed by it, and with nothing mapped they are all dark — so coverage
          belongs on the dashboard and the 218-row queue belongs behind it.
          Same shape as Reorder inside Stock: a long list should not dominate a
          page nobody opened for it. */}
      {coverage !== null && coverage.items_seen > 0 && Number(coverage.pct_attributed) < 100 && (
        <Link
          href="/sales/books/sales/mapping"
          className={`${cardCls} mb-4 block border-red-200 bg-red-50/60 hover:border-red-400`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Revenue with no department</h2>
            <span className="font-mono text-[11px] text-stone-400">mapping_coverage</span>
          </div>
          <p className={`mt-1.5 ${heroNumCls} text-3xl text-red-700`}>
            {(100 - Number(coverage.pct_attributed)).toFixed(1)}%
          </p>
          <p className="mt-1 text-sm text-stone-700">
            {coverage.items_seen - coverage.items_mapped} of {coverage.items_seen} POS items are not attributed to a
            department. Sales by department, food cost, margin and the department pages all read this — and all stay
            dark until it is done. Map the biggest rows first →
          </p>
        </Link>
      )}

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
        <PeriodControl period={period} today={periodToday} error={periodReq.error} basePath="/sales" />
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

        {/* THE TRADING DAY. Two services show up as two humps, and that shape
            is worth more than the total — a place with one peak and a place
            with two are run differently. */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>By hour</h2>
            <span className="font-mono text-[11px] text-stone-400">sales_by_hour</span>
          </div>
          {hours.length === 0 ? (
            <div className="mt-2">
              <Unassessed needs="no hour has any sales">
                Nothing fetched for this period carries an order time, so the trading day cannot be drawn.
              </Unassessed>
            </div>
          ) : (
            <>
              <div className="mt-2">
                <HourlyLine points={hours} />
              </div>
              {/* SURFACED, NOT SMOOTHED. A cover count three times out of line
                  is a data-entry question, and charting past it would hide the
                  one thing worth asking Petpooja about. */}
              {oddHours.length > 0 && medianPerCover !== null && (
                <div className="mt-3">
                  <Honesty verdict="covers look wrong" compact>
                    {oddHours
                      .map((h) => `${h.hour}:00 reads ${formatMoneyString(h.per_cover as string)} per cover`)
                      .join(', ')}{' '}
                    against {formatPaise(Math.round(medianPerCover * 100))} across the rest of the day. Almost
                    certainly covers under-counted at that hour rather than spend being three times higher — a
                    Petpooja data-entry question, not a finding about the business.
                  </Honesty>
                </div>
              )}
            </>
          )}
        </section>

        {/* OUR SPLIT IS BETTER THAN THE POS'S — Petpooja lumps three quarters
            of a day into "Other"; we hold every mode separately.
            BARS, NOT A DONUT, and the reason is the palette: only three
            categorical hues are validated for this app (CVD ΔE 25.3), and
            seven modes through a three-hue donut would repeat colours. Named
            bars need no hue at all to tell the modes apart, which is exactly
            the contrast being drawn with a POS screen that cannot. */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>How they paid</h2>
            <span className="font-mono text-[11px] text-stone-400">sales_current</span>
          </div>
          {split.length === 0 ? (
            <div className="mt-2">
              <Unassessed needs="no day fetched">
                No orders in this period, so there is no split to show.
              </Unassessed>
            </div>
          ) : (
            <>
              <div className="mt-2">
                <MagnitudeBars
                  rows={split.map((r) => ({ label: r.payment_mode, value: Number(r.revenue) }))}
                  height={Math.max(140, split.length * 30)}
                />
              </div>
              <p className="mt-1 text-xs text-stone-400">
                {split.length} modes held separately — the POS&rsquo;s own dashboard reports most of this as
                &ldquo;Other&rdquo;.
              </p>
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
