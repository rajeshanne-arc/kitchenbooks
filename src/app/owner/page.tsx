import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import { getFoodCost } from '@/server/kitchen-queries'
import {
  getEntryPulse,
  getMissingCloses,
  getOwed,
  getSalesSeries,
  getSectionCostsRange,
  getSettlementGap,
  getStaffCard,
  getStockAlarms,
  getUnknownStatusCount,
  getUnmappedSummary,
  getWasteRange,
  getYesterday,
} from '@/server/dashboard-queries'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { isPeriodKey, monthLabel, resolvePeriod, type PeriodKey } from '@/lib/period'
import { requires, UNASSESSABLE_URGENCY } from '@/lib/precondition'
import { countOrdersWithTime, getBusinessDayDisagreements } from '@/server/business-day'
import { cardCls, heroNumCls, moneyCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'
import Honesty, { HonestyPill } from '@/components/Honesty'
import MyQueriesPanel from '@/components/accountant/MyQueriesPanel'
import PeriodControl from '@/components/dashboard/PeriodControl'
import Unassessed, { unassessedToneCls } from '@/components/dashboard/Unassessed'
import {
  BilledVsClaimed,
  DivergingBars,
  MagnitudeBars,
  SalesLine,
  TargetBars,
  TwoSeriesLegend,
} from '@/components/dashboard/Charts'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

// The owner's questions, ordered by URGENCY rather than by a layout someone
// liked once. Each card computes its own urgency from what it actually found,
// and the page sorts on that — so a broken thing rises to the top of the
// screen on the day it breaks and sinks again when it is fixed. Nothing here
// is a chart for its own sake: a single number stays a number, and a chart
// appears only where a shape is easier to read than a list.
//
// Every card also carries a SENTENCE. A figure alone makes the owner do the
// interpreting; the sentence states the finding and the figure backs it up.

const FOOD_COST_TARGET = 35

// A card is pass, fail, or CANNOT BE ASSESSED. The third state exists because
// four cards here once reported clean bills of health over data the card above
// them had just said was absent — "every order carries a status the app knows"
// over no orders at all. See src/lib/precondition.ts.
type Level = 'alarm' | 'doubt' | 'calm' | 'unassessable'

/** Base weights: what KIND of question this is. A card adds to its base
 *  according to what it found, so an alarming staff card can still outrank a
 *  calm settlement card without either changing category. */
/** A card that IS assessable, found nothing wrong, and had something to look
 *  at. It outranks a card that found nothing because there was nothing —
 *  but it must sit BELOW an unassessable one, because not knowing is worse
 *  than knowing it is well. That is the law in precondition.ts, and these
 *  four were the exception that broke it. */
const HEALTHY_WITH_CONTENT = UNASSESSABLE_URGENCY - 10

const URGENCY = {
  impossible: 900, // negative stock — arithmetic that cannot be true
  unbanked: 800, // money the app refuses to count
  miscut: 750, // the POS and we disagree about which day an order belongs to
  unclosed: 700, // a day that sold food and was never counted
  gap: 600, // an aggregator disagreeing with us
  unclaimed: 500, // revenue belonging to no section
  cash: 400,
  ratio: 300,
  margin: 250,
  waste: 200,
  owed: 150,
  people: 100,
  // UNASSESSABLE_URGENCY (60) sits below every weight here and above a healthy
  // card's 0: worse than knowing it is well, better than a real finding.
} as const

type Question = {
  key: string
  urgency: number
  node: React.ReactNode
}

function Card({
  title,
  source,
  href,
  sentence,
  level = 'calm',
  children,
}: {
  title: string
  source: string
  href: string
  sentence: React.ReactNode
  level?: Level
  children?: React.ReactNode
}) {
  const tone =
    level === 'alarm'
      ? 'border-red-300 bg-red-50/50 hover:border-red-400'
      : level === 'doubt'
        ? 'border-amber-300 bg-amber-50/40 hover:border-amber-500'
        : level === 'unassessable'
          ? unassessedToneCls
          : 'border-rule bg-cell hover:border-emerald-400'
  return (
    <Link href={href} className={`${cardCls} block ${tone}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={`${sectionHeadCls} ${level === 'alarm' ? 'text-red-700' : ''}`}>{title}</h2>
        <span className="font-mono text-[10px] text-stone-400">{source} →</span>
      </div>
      <p
        className={`mt-1.5 text-sm ${
          level === 'alarm'
            ? 'font-medium text-red-800'
            : level === 'doubt'
              ? 'text-amber-900'
              : level === 'unassessable'
                ? 'text-stone-600'
                : 'text-stone-700'
        }`}
      >
        {sentence}
      </p>
      {children !== undefined && <div className="mt-2">{children}</div>}
    </Link>
  )
}

/**
 * A card in the third state: what is missing, what therefore cannot be judged,
 * and the SAME link the assessable card carries — the reader's next move is to
 * go and enter the thing that is absent. It never says anything is fine.
 */
function CannotAssess({
  title,
  source,
  href,
  check,
  children,
}: {
  title: string
  source: string
  href: string
  check: { needs: string; why: string }
  children?: React.ReactNode
}) {
  return (
    <Card title={title} source={source} href={href} level="unassessable" sentence={check.why}>
      <Unassessed needs={check.needs}>{children}</Unassessed>
    </Card>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : 'this-month'
  const today = await businessToday()
  const period = resolvePeriod(periodKey, today)

  const restaurant = await getRestaurant()
  const user = await getSessionUser()

  const [
    pulse,
    salesSeries,
    yesterday,
    settlements,
    sections,
    foodCost,
    owed,
    unmapped,
    waste,
    alarms,
    unknownCount,
    missing,
    staff,
    dayGaps,
    timed,
  ] = await Promise.all([
    getEntryPulse(restaurant.id, period.from, period.to),
    getSalesSeries(restaurant.id, period.from, period.to),
    getYesterday(restaurant.id),
    getSettlementGap(restaurant.id, period.from, period.to),
    getSectionCostsRange(restaurant.id, period.months),
    getFoodCost(restaurant.id, period.reportMonth),
    getOwed(restaurant.id),
    getUnmappedSummary(restaurant.id, period.from, period.to),
    getWasteRange(restaurant.id, period.from, period.to),
    getStockAlarms(restaurant.id),
    getUnknownStatusCount(restaurant.id, period.from, period.to),
    getMissingCloses(restaurant.id, period.from, period.to),
    getStaffCard(restaurant.id, today),
    getBusinessDayDisagreements(restaurant.id),
    countOrdersWithTime(restaurant.id),
  ])

  // What the sales-dependent cards rest on, stated ONCE so five of them ask
  // the same question of the same data rather than each guessing.
  //
  // A card whose own finding is non-empty is assessable by that finding alone:
  // an unknown status can only exist if an order arrived, so the finding is
  // its own proof the fetch happened. The precondition is what makes the
  // ABSENCE of a finding mean something.
  const posOrders = salesSeries.reduce((n, p) => n + p.orders, 0)
  const mappedSalesPaise = sections.reduce((n, s) => n + decimalStringToPaise(s.sales), 0)

  const questions: Question[] = []

  /* ── negative stock — the only impossible number on the page ────────── */
  questions.push({
    key: 'stock',
    urgency: alarms.length > 0 ? URGENCY.impossible : 0,
    node:
      alarms.length > 0 ? (
        <Card
          title="Stock alarms"
          source="stock_on_hand"
          href="/store/books/stock"
          level="alarm"
          sentence={`${alarms.length} ${plural(alarms.length, 'item has', 'items have')} been issued more than ${plural(alarms.length, 'it was', 'they were')} ever bought. A purchase bill is missing.`}
        >
          <ul className="space-y-0.5">
            {alarms.slice(0, 5).map((a) => (
              <li key={a.code} className={`text-sm font-semibold text-red-700 ${moneyCls}`}>
                {a.name}: {a.on_hand_qty} {a.purchase_unit}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card
          title="Stock alarms"
          source="stock_on_hand"
          href="/store/books/stock"
          sentence="No item is showing negative stock."
        />
      ),
  })

  /* ── Which day an order belongs to ──────────────────────────────────── */
  {
    // The comparison can only be made over orders that carried a TIME. No
    // times means no comparison — not agreement — so this card declares that
    // precondition rather than reporting a confident all-clear over nothing.
    const disagreed = dayGaps.reduce((n, r) => n + r.orders, 0)
    const check = requires(
      timed.withTime > 0,
      disagreed,
      'no order carried a time',
      timed.total === 0
        ? 'No POS order has been fetched, so whether our day and Petpooja\u2019s start at the same hour cannot be compared.'
        : `None of the ${timed.total} orders fetched so far carried a time, so our cutover cannot be compared with Petpooja\u2019s. The next fetch stores it.`,
    )
    questions.push({
      key: 'business-day',
      urgency: !check.assessable ? UNASSESSABLE_URGENCY : check.data > 0 ? URGENCY.miscut : 0,
      node: !check.assessable ? (
        <CannotAssess
          title="Which day an order belongs to"
          source="business_day_disagreements"
          href="/sales/books/sales"
          check={check}
        >
          A restaurant serving past midnight has a day that does not end at midnight. This card
          checks that we and the POS cut the night in the same place.
        </CannotAssess>
      ) : check.data > 0 ? (
        <Card
          title="Which day an order belongs to"
          source="business_day_disagreements"
          href="/accounts"
          level="alarm"
          sentence={`${check.data} ${plural(check.data, 'order')} sits on a different date in Petpooja than it does here, so those days cannot be reconciled against their dashboard.`}
        >
          <ul className="mt-1 space-y-1">
            {dayGaps.slice(0, 4).map((r) => (
              <li key={`${r.pos_says}-${r.we_say}`} className="text-sm text-stone-700">
                POS says {fmtDate(r.pos_says)} · we say {fmtDate(r.we_say)} —{' '}
                <span className="font-mono">{r.orders}</span>
              </li>
            ))}
          </ul>
          <Honesty level="alarm" verdict="cutover disagrees" compact>
            The likely cause is business_day_start not matching how the POS was configured. Neither
            side is wrong on its own; they are simply cutting the night in different places.
          </Honesty>
        </Card>
      ) : (
        <Card
          title="Which day an order belongs to"
          source="business_day_disagreements"
          href="/accounts"
          sentence="Every order sits on the same day here as it does in Petpooja."
        />
      ),
    })
  }

  /* ── POS statuses the app refuses to bank ───────────────────────────── */
  {
    // an unknown status is itself proof an order arrived; without one, the
    // all-clear would be over an empty set
    const check = requires(
      unknownCount > 0 || posOrders > 0,
      unknownCount,
      'no orders fetched',
      'No POS order arrived in this period, so whether every order carries a status this app knows cannot be judged — there is nothing to read.',
    )
    questions.push({
      key: 'unknown-status',
      urgency: !check.assessable ? UNASSESSABLE_URGENCY : check.data > 0 ? URGENCY.unbanked : 0,
      node: !check.assessable ? (
        <CannotAssess
          title="Unknown POS statuses"
          source="sales_current"
          href="/sales/books/sales"
          check={check}
        >
          Fetch a day under Sales → Books → Fetch a day and this card starts reading statuses.
        </CannotAssess>
      ) : check.data > 0 ? (
        <Card
          title="Unknown POS statuses"
          source="sales_current"
          href="/sales/books/sales"
          level="alarm"
          sentence={`${unknownCount} ${plural(unknownCount, 'order')} came back with a status this app does not know, so ${plural(unknownCount, 'it is', 'they are')} not counted as revenue.`}
        >
          <Honesty level="alarm" verdict="not banked" compact>
            Status is a whitelist. Anything outside Success, Cancelled and Complimentary waits for a human to
            read it rather than being guessed into the takings.
          </Honesty>
        </Card>
      ) : (
        <Card
          title="Unknown POS statuses"
          source="sales_current"
          href="/sales/books/sales"
          sentence="Every order carries a status the app knows. Nothing is waiting to be banked."
        />
      ),
    })
  }

  /* ── days that sold food and were never counted ─────────────────────── */
  {
    // the card counts days that SOLD food; with no such day the all-clear is
    // over an empty set. A day already found missing proves sales existed.
    const check = requires(
      missing.length > 0 || salesSeries.length > 0,
      missing,
      'no day sold food',
      'No day in this period has sales against it, so there is no day whose cash could be waiting to be counted.',
    )
    questions.push({
      key: 'missing-closes',
      urgency: !check.assessable ? UNASSESSABLE_URGENCY : check.data.length > 0 ? URGENCY.unclosed : 0,
      node: !check.assessable ? (
        <CannotAssess title="Days not closed" source="missing_closes" href="/sales" check={check}>
          A close is filed against a day that sold. Fetch a sales day and this card can start naming the days
          that were never counted.
        </CannotAssess>
      ) : check.data.length > 0 ? (
        <Card
          title="Days not closed"
          source="missing_closes"
          href="/sales"
          level="alarm"
          sentence={`${missing.length} ${plural(missing.length, 'day')} sold food and never had ${plural(missing.length, 'its', 'their')} cash counted. A shortage belongs to the day it happened.`}
        >
          <p className="text-xs text-stone-600">{missing.slice(0, 8).map((d) => fmtDate(d)).join(' · ')}</p>
        </Card>
      ) : (
        <Card
          title="Days not closed"
          source="missing_closes"
          href="/sales"
          sentence="Every day that sold food has its cash counted."
        />
      ),
    })
  }

  /* ── the settlement gap — deliberately high on the page ──────────────── */
  {
    const gapPaise = settlements.reduce((n, s) => n + decimalStringToPaise(s.gap), 0)
    const uncompared = settlements.reduce((n, s) => n + s.uncompared, 0)
    const disputed = settlements.filter((s) => decimalStringToPaise(s.gap) !== 0)
    const chartRows = settlements
      .filter((s) => Number(s.billed) !== 0 || Number(s.claimed) !== 0)
      .slice(0, 5)
      .map((s) => ({ label: s.partner, billed: Number(s.billed), claimed: Number(s.claimed) }))

    // the gap is billed MINUS claimed: a settlement with only one side filled
    // in coalesces to a zero gap, which would read as agreement. Nothing can
    // be compared until at least one settlement carries both numbers.
    const compared = settlements.reduce((n, s) => n + (s.settlements - s.uncompared), 0)
    const check = requires(
      compared > 0,
      settlements,
      settlements.length === 0 ? 'no settlement filed' : 'no settlement has both sides',
      settlements.length === 0
        ? 'No aggregator settlement has been filed for this period, so what we billed has nothing to be compared against.'
        : `${uncompared} filed ${plural(uncompared, 'settlement')} ${plural(uncompared, 'carries', 'carry')} only one side of the comparison, so whether the partners agree with what we billed cannot be judged.`,
    )

    const sentence =
      gapPaise > 0
        ? `${formatPaise(gapPaise)} of what we billed has not been accepted by ${disputed.length === 1 ? disputed[0].partner : `${disputed.length} partners`}.`
        : gapPaise < 0
          ? `${formatPaise(Math.abs(gapPaise))} more has been claimed than we billed — our own billing is probably short.`
          : // "every partner" would cover the one-sided filings too, and those
            // were never compared at all
            uncompared > 0
            ? 'Every partner with both sides on file agrees with what we billed.'
            : 'Every partner agrees with what we billed.'

    questions.push({
      key: 'settlement-gap',
      urgency: !check.assessable
        ? UNASSESSABLE_URGENCY
        : gapPaise !== 0
          ? URGENCY.gap
          : uncompared > 0
            ? URGENCY.gap - 50
            : HEALTHY_WITH_CONTENT,
      node: !check.assessable ? (
        <CannotAssess
          title="Aggregator gap"
          source="partner_settlements · partners"
          href="/sales/settlements"
          check={check}
        >
          {settlements.length === 0
            ? 'File one under Sales → Settlements and this card starts comparing their statement against our bills.'
            : `Both sides are needed: ${settlements.map((s) => s.partner).join(' · ')}.`}
        </CannotAssess>
      ) : (
        <Card
          title="Aggregator gap"
          source="partner_settlements · partners"
          href="/sales/settlements"
          level={gapPaise !== 0 ? 'alarm' : uncompared > 0 ? 'doubt' : 'calm'}
          sentence={sentence}
        >
          <>
            {chartRows.length > 0 && (
              <>
                <BilledVsClaimed rows={chartRows} />
                <TwoSeriesLegend />
              </>
            )}
            <ul className="mt-2 space-y-1">
              {settlements.slice(0, 5).map((s) => {
                const g = decimalStringToPaise(s.gap)
                const gross = Number(s.gross_sales)
                const effective = gross > 0 ? (Number(s.commission) / gross) * 100 : null
                const agreed = s.agreed_pct === null ? null : Number(s.agreed_pct)
                const overCharging = effective !== null && agreed !== null && effective - agreed > 0.5
                return (
                  <li key={s.partner} className="text-xs">
                    <span className="font-medium text-stone-800">{s.partner}</span>{' '}
                    {g === 0 ? (
                      <span className="text-emerald-700">agrees</span>
                    ) : (
                      <span className={`${moneyCls} font-semibold text-red-700`}>
                        {g > 0 ? 'short by ' : 'over by '}
                        {formatPaise(Math.abs(g))}
                      </span>
                    )}
                    {effective !== null && agreed !== null && (
                      <span className={overCharging ? 'text-red-700' : 'text-stone-500'}>
                        {' · '}took {effective.toFixed(1)}% vs {agreed}% agreed
                      </span>
                    )}
                    {effective !== null && agreed === null && (
                      <span className="text-stone-500"> · took {effective.toFixed(1)}%, no agreed rate on file</span>
                    )}
                  </li>
                )
              })}
            </ul>
            {uncompared > 0 && (
              <div className="mt-2">
                <Honesty verdict="not compared" compact>
                  {uncompared} {plural(uncompared, 'settlement')} {plural(uncompared, 'has', 'have')} only one
                  side filled in — the gap below counts only the ones where both numbers are on file.
                </Honesty>
              </div>
            )}
          </>
        </Card>
      ),
    })
  }

  /* ── revenue that belongs to no dish ─────────────────────────────────── */
  {
    // "everything sold is mapped" is a claim about what was sold; an unmapped
    // item is itself proof something was sold, so only the all-clear needs a
    // fetched order behind it
    const check = requires(
      unmapped.items > 0 || posOrders > 0,
      unmapped,
      'no orders fetched',
      'Nothing has been sold in this period, so whether everything sold reaches a dish cannot be judged — no POS item has arrived to map.',
    )
    questions.push({
      key: 'unmapped',
      urgency: !check.assessable ? UNASSESSABLE_URGENCY : check.data.items > 0 ? URGENCY.unclaimed : 0,
      node: !check.assessable ? (
        <CannotAssess
          title="Unmapped POS revenue"
          source="unmapped_pos_items"
          href="/sales/books/sales/mapping"
          check={check}
        >
          Mapping points a POS item at a dish, and the dish carries the section. Until a day is fetched there is
          nothing in the queue.
        </CannotAssess>
      ) : check.data.items > 0 ? (
        <Card
          title="Unmapped POS revenue"
          source="unmapped_pos_items"
          href="/sales/books/sales/mapping"
          level="alarm"
          sentence={`${formatMoneyString(unmapped.revenue)} was sold by ${unmapped.items} POS ${plural(unmapped.items, 'item')} that no dish claims, so it belongs to no section and no food cost.`}
        >
          <p className={`text-[26px] ${heroNumCls} text-red-700`}>{formatMoneyString(unmapped.revenue)}</p>
          <p className="mt-1 text-xs text-stone-600">
            The queue is ordered by revenue — the top rows are half the money.
          </p>
        </Card>
      ) : (
        <Card
          title="Unmapped POS revenue"
          source="unmapped_pos_items"
          href="/sales/books/sales/mapping"
          sentence="Everything sold is mapped to a dish."
        />
      ),
    })
  }

  /* ── sales across the period, and yesterday's drawer ─────────────────── */
  {
    const diffPaise = yesterday.difference === null ? null : decimalStringToPaise(yesterday.difference)
    const total = salesSeries.reduce((n, p) => n + decimalStringToPaise(p.revenue), 0)
    // the denominator itself. It sits at the unassessable rank rather than the
    // bottom of the page, because it is the cause of every card below it.
    const check = requires(
      salesSeries.length > 0,
      salesSeries,
      'no sales day fetched',
      `No POS day has been fetched between ${fmtDate(period.from)} and ${fmtDate(period.to)}, so this period has no sales figure to state.`,
    )
    const sentence =
      diffPaise === null
        ? `${formatPaise(total)} across ${salesSeries.length} ${plural(salesSeries.length, 'day')}. Yesterday is not closed yet.`
        : diffPaise === 0
          ? `${formatPaise(total)} across ${salesSeries.length} ${plural(salesSeries.length, 'day')}, and yesterday's cash squared exactly.`
          : `${formatPaise(total)} across ${salesSeries.length} ${plural(salesSeries.length, 'day')}, but yesterday's drawer was out by ${formatPaise(Math.abs(diffPaise))}.`
    questions.push({
      key: 'sales',
      urgency: !check.assessable
        ? UNASSESSABLE_URGENCY
        : diffPaise !== null && diffPaise !== 0
          ? URGENCY.cash
          : HEALTHY_WITH_CONTENT,
      node: !check.assessable ? (
        <CannotAssess
          title="Sales"
          source="sales_by_day · day_close_ladder"
          href="/sales/books/sales"
          check={check}
        >
          Fetch a day under Sales → Books → Fetch a day. Every percentage on this page that divides by sales
          waits on it.
        </CannotAssess>
      ) : (
        <Card
          title="Sales"
          source="sales_by_day · day_close_ladder"
          href="/sales/books/sales"
          level={diffPaise !== null && diffPaise !== 0 ? 'alarm' : 'calm'}
          sentence={sentence}
        >
          {salesSeries.length === 1 ? (
            <p className={`text-[26px] ${heroNumCls} text-stone-900`}>
              {formatMoneyString(salesSeries[0].revenue)}
            </p>
          ) : (
            <SalesLine points={salesSeries} />
          )}
        </Card>
      ),
    })
  }

  /* ── food cost against target, for the period's reporting month ──────── */
  {
    const withPct = foodCost.filter((f) => f.food_cost_pct !== null)
    const pending = foodCost.filter((f) => f.has_activity && f.consumed_total === null)
    const over = withPct.filter((f) => Number(f.food_cost_pct) > FOOD_COST_TARGET)
    // the view already withholds a percentage until the month has a closing
    // AND mapped sales; with none stated there is no ratio to be at or under
    // the target, and the two reasons are different errands
    const check = requires(
      withPct.length > 0,
      withPct,
      pending.length > 0 ? 'no closing filed' : 'no costed section this month',
      pending.length > 0
        ? `${pending.length} ${plural(pending.length, 'section')} moved stock but ${plural(pending.length, 'has', 'have')} no closing filed, so consumption is unfinished and no food cost percentage can be worked out.`
        : `No section has both consumption and sales in ${monthLabel(period.reportMonth)}, so there is nothing to measure against ${FOOD_COST_TARGET}%.`,
    )
    const sentence =
      over.length > 0
        ? `${over.map((f) => f.section_name).join(', ')} ${over.length === 1 ? 'is' : 'are'} running above ${FOOD_COST_TARGET}% food cost.`
        : `Every costed section is at or under ${FOOD_COST_TARGET}%.`
    questions.push({
      key: 'food-cost',
      urgency: !check.assessable ? UNASSESSABLE_URGENCY : over.length > 0 ? URGENCY.ratio : HEALTHY_WITH_CONTENT,
      node: !check.assessable ? (
        <CannotAssess
          title={`Food cost % — ${monthLabel(period.reportMonth)}`}
          source="section_food_cost"
          href="/kitchen/books/food-cost"
          check={check}
        >
          {pending.length > 0 ? (
            <ul className="mt-0.5 space-y-1">
              {pending.map((f) => (
                <li key={f.section_code} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-stone-600">{f.section_name}</span>
                  <HonestyPill>pending closing</HonestyPill>
                </li>
              ))}
            </ul>
          ) : (
            'Food cost is consumption over sales. Both halves have to arrive before a percentage means anything.'
          )}
        </CannotAssess>
      ) : (
        <Card
          title={`Food cost % — ${monthLabel(period.reportMonth)}`}
          source="section_food_cost"
          href="/kitchen/books/food-cost"
          level={over.length > 0 ? 'doubt' : 'calm'}
          sentence={sentence}
        >
          <>
            <TargetBars
              rows={withPct.map((f) => ({ label: f.section_name, pct: Number(f.food_cost_pct) }))}
              target={FOOD_COST_TARGET}
            />
            {/* one costed section makes the card assessable; the sentence says
                "every COSTED section", and this names the ones it is not about */}
            {pending.length > 0 && (
              <div className="mt-2">
                <Honesty
                  verdict="pending closing"
                  meter={{ filled: withPct.length, total: withPct.length + pending.length, unit: 'sections' }}
                  compact
                >
                  {pending.map((f) => f.section_name).join(' · ')} moved stock with no closing filed, so{' '}
                  {plural(pending.length, 'its', 'their')} consumption is unfinished and{' '}
                  {plural(pending.length, 'it is', 'they are')} not in the bars above.
                </Honesty>
              </div>
            )}
          </>
        </Card>
      ),
    })
  }

  /* ── margin by section ───────────────────────────────────────────────── */
  {
    // margin is sales MINUS cost, and section_costs lists a section that only
    // spent. With no sales mapped to any section every margin is just its cost
    // wearing a minus sign — a missing half of the sum reported as a business
    // problem, which is the sharpest instance of the whole fault.
    const check = requires(
      mappedSalesPaise > 0,
      sections,
      'no sales mapped to a section',
      'No revenue reached a section in this period, so every section reads as a loss the exact size of what it spent. That is the earning side of the comparison missing, not a section losing money.',
    )
    // the same fault one row down: one mapped section makes the CARD
    // assessable, and every section beside it with no revenue would still be
    // named as losing money. A section is comparable only where both halves of
    // the subtraction arrived, so the others are named as unmeasured instead.
    const earning = sections.filter((s) => decimalStringToPaise(s.sales) !== 0)
    const unearning = sections.filter((s) => decimalStringToPaise(s.sales) === 0)
    const losing = earning.filter((s) => decimalStringToPaise(s.margin) < 0)
    const sentence =
      losing.length > 0
        ? `${losing.map((s) => s.section_name).join(', ')} ${losing.length === 1 ? 'costs' : 'cost'} more than ${losing.length === 1 ? 'it earns' : 'they earn'}.`
        : 'Every section with revenue against it is earning more than it costs.'
    questions.push({
      key: 'margin',
      urgency: !check.assessable ? UNASSESSABLE_URGENCY : losing.length > 0 ? URGENCY.margin : HEALTHY_WITH_CONTENT,
      node: !check.assessable ? (
        <CannotAssess
          title="Margin by section"
          source="section_costs"
          href="/kitchen/books/sections"
          check={check}
        >
          {sections.length > 0
            ? `${sections.length} ${plural(sections.length, 'section')} spent money in this period and none of them has revenue against it. Sales reach a section through the dish a POS item is mapped to.`
            : 'Nothing was earned or spent by any section in this period.'}
        </CannotAssess>
      ) : (
        <Card
          title="Margin by section"
          source="section_costs"
          href="/kitchen/books/sections"
          level={losing.length > 0 ? 'doubt' : 'calm'}
          sentence={sentence}
        >
          <>
            <DivergingBars
              rows={earning.slice(0, 6).map((s) => ({ label: s.section_name, value: Number(s.margin) }))}
              height={Math.max(120, Math.min(earning.length, 6) * 30 + 40)}
            />
            {unearning.length > 0 && (
              <div className="mt-2">
                <Honesty verdict="no sales mapped" compact>
                  {unearning.map((s) => s.section_name).join(' · ')} spent money with no revenue mapped against{' '}
                  {plural(unearning.length, 'it', 'them')} — left out of the bars rather than drawn as a loss
                  the size of what was spent.
                </Honesty>
              </div>
            )}
          </>
        </Card>
      ),
    })
  }

  /* ── waste ───────────────────────────────────────────────────────────── */
  {
    const wasteTotal = decimalStringToPaise(waste.storeValue) + decimalStringToPaise(waste.kitchenValue)
    questions.push({
      key: 'waste',
      urgency: wasteTotal > 0 ? URGENCY.waste : 0,
      node: (
        <Card
          title="Waste"
          source="wastage · kitchen_wastage"
          href="/store/books/log"
          sentence={
            wasteTotal === 0
              ? 'No waste was recorded in this period.'
              : `${formatPaise(wasteTotal)} was thrown away — ${formatMoneyString(waste.storeValue)} in the store, ${formatMoneyString(waste.kitchenValue)} in the kitchens.`
          }
        >
          {waste.reasons.length > 0 && (
            <MagnitudeBars
              rows={waste.reasons.map((r) => ({ label: r.reason, value: Number(r.value) }))}
              height={Math.max(110, waste.reasons.length * 28 + 40)}
            />
          )}
        </Card>
      ),
    })
  }

  /* ── owed ────────────────────────────────────────────────────────────── */
  {
    const vendorPaise = decimalStringToPaise(owed.vendorTotal)
    const ownerPaise = owed.owners.reduce((n, o) => n + decimalStringToPaise(o.balance), 0)
    questions.push({
      key: 'owed',
      urgency: vendorPaise > 0 || ownerPaise > 0 ? URGENCY.owed : 0,
      node: (
        <Card
          title="Owed"
          source="vendor_dues · owners_owed"
          href="/store/masters/vendors"
          sentence={
            vendorPaise === 0 && ownerPaise === 0
              ? 'Nothing is outstanding to vendors or owners.'
              : `${formatPaise(vendorPaise)} is outstanding to vendors${ownerPaise > 0 ? `, and ${formatPaise(ownerPaise)} to owners who paid out of pocket` : ''}.`
          }
        >
          {owed.vendors.length > 0 && (
            <ul className="space-y-0.5">
              {owed.vendors.map((v) => (
                <li key={v.name} className="flex justify-between gap-2 text-xs text-stone-600">
                  <span className="truncate">{v.name}</span>
                  <span className={`${moneyCls} shrink-0`}>{formatMoneyString(v.balance)}</span>
                </li>
              ))}
            </ul>
          )}
          {owed.owners.length > 0 && (
            <p className="mt-1.5 text-xs text-amber-900">
              {owed.owners.map((o) => `${o.person} ${formatMoneyString(o.balance)}`).join(' · ')}
            </p>
          )}
        </Card>
      ),
    })
  }

  /* ── people ──────────────────────────────────────────────────────────── */
  {
    const behind = staff.markable > 0 && staff.markedToday < staff.markable
    questions.push({
      key: 'staff',
      urgency: staff.unassigned > 0 ? URGENCY.people + 40 : behind ? URGENCY.people : 0,
      node: (
        <Card
          title="Staff"
          source="staff · attendance_current"
          href="/staff/people/attendance"
          level={staff.unassigned > 0 ? 'doubt' : 'calm'}
          sentence={
            staff.activeStaff === 0
              ? 'No staff are on the roster yet.'
              : staff.unassigned > 0
                ? `${staff.unassigned} of ${staff.activeStaff} active staff have no section, so their wages land on nobody's food cost.`
                : behind
                  ? `Today's attendance is ${staff.markedToday} of ${staff.markable} marked.`
                  : `All ${staff.activeStaff} active staff are assigned and marked for today.`
          }
        />
      ),
    })
  }

  // urgency first, then a stable key order so a quiet dashboard does not
  // reshuffle itself between reloads
  questions.sort((a, b) => b.urgency - a.urgency || a.key.localeCompare(b.key))

  const nothingEntered =
    pulse.bills === 0 &&
    pulse.issues === 0 &&
    pulse.salesDays === 0 &&
    pulse.closes === 0 &&
    pulse.expenses === 0
  const thin = !nothingEntered && pulse.salesDays === 0

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>{restaurant.name}</h1>
        <p className={pageSubCls}>
          {period.label} · {period.from === period.to ? fmtDate(period.from) : `${fmtDate(period.from)} — ${fmtDate(period.to)}`}
        </p>
      </header>

      {/* What the accountant is asking. Managers and owners see what they are
          covering for too — a loop that stalls on one absence is unused. */}
      <div className="pb-4">
        <MyQueriesPanel />
      </div>

      <div className="pb-4">
        <PeriodControl active={periodKey} />
      </div>

      {/* The honest empty state. Two bills and no sales is the ordinary
          starting condition, not a catastrophic month, and the page says so
          before it shows a screen of zeroes. */}
      {nothingEntered ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Nothing entered for this period</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            No bills, issues, sales or closes have been recorded between {fmtDate(period.from)} and{' '}
            {fmtDate(period.to)}. The cards below have nothing to measure yet — that is an empty book, not a bad
            month.
          </p>
          <p className="mt-2 text-xs text-stone-500">
            The book fills from the bottom up: purchase bills give items their cost, issues turn that cost into
            section consumption, and a fetched sales day turns consumption into a food cost percentage.
          </p>
        </section>
      ) : (
        thin && (
          <section className={`${cardCls} border-amber-300 bg-amber-50/40`}>
            <h2 className={sectionHeadCls}>Costs are in, sales are not</h2>
            <p className="mt-1.5 text-sm text-amber-900">
              {pulse.bills} {plural(pulse.bills, 'bill')} and {pulse.issues} {plural(pulse.issues, 'issue')} are
              recorded for this period, but no sales day has been fetched. Every percentage that divides by sales
              stays blank until one is — the app will not guess a denominator.
            </p>
          </section>
        )
      )}

      <div className={`grid gap-3 sm:grid-cols-2 ${nothingEntered || thin ? 'mt-3' : ''}`}>
        {questions.map((q) => (
          <div key={q.key}>{q.node}</div>
        ))}
      </div>

      {user !== null && canAccess(user.role, '/owner/pnl') && (
        <Link
          href="/owner/pnl"
          className="mt-3 flex items-center justify-between rounded-2xl border border-emerald-700 bg-emerald-700 p-4 text-white hover:bg-emerald-800"
        >
          <span className="text-[15px] font-semibold">P&amp;L — the month, added up</span>
          <span>→</span>
        </Link>
      )}

      <p className="mt-4 text-xs text-stone-400">
        Cards are ordered by what is most wrong, not by a fixed layout. Every one reads a named view and clicks
        through to its source.
      </p>
    </>
  )
}
