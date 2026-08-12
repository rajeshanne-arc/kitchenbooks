import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getSalesSeries, getYesterday, getUnmappedSummary, getMissingCloses } from '@/server/dashboard-queries'
import { getGstServiceByDay } from '@/server/reports-queries'
import { todayIST } from '@/server/store-queries'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { isPeriodKey, resolvePeriod, type PeriodKey } from '@/lib/period'
import {
  cardCls, heroNumCls, pageSubCls, pageTitleCls, sectionHeadCls,
} from '@/components/ui'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { SalesLine } from '@/components/dashboard/Charts'
import Honesty from '@/components/Honesty'
import MyQueriesPanel from '@/components/accountant/MyQueriesPanel'

export const dynamic = 'force-dynamic'

// The cashier's own dashboard. Day close moved into Record — it is a daily
// money event like the vouchers beside it — so this tab is now what the
// cashier looks at rather than what they type into.

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

export default async function SalesDashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : 'this-month'
  const period = resolvePeriod(periodKey, todayIST())
  const restaurant = await getRestaurant()

  const [series, yesterday, unmapped, missing, gst] = await Promise.all([
    getSalesSeries(restaurant.id, period.from, period.to),
    getYesterday(restaurant.id),
    getUnmappedSummary(restaurant.id),
    getMissingCloses(restaurant.id),
    getGstServiceByDay(restaurant.id, period.from, period.to),
  ])

  const total = series.reduce((n, p) => n + decimalStringToPaise(p.revenue), 0)
  const diff = yesterday.difference === null ? null : decimalStringToPaise(yesterday.difference)
  const foodBev = gst.reduce((n, r) => n + decimalStringToPaise(r.food_bev), 0)
  const gstTotal = gst.reduce((n, r) => n + decimalStringToPaise(r.gst_collected), 0)
  const effective = foodBev > 0 ? (gstTotal / foodBev) * 100 : null

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

      <div className="pb-4">
        <PeriodControl active={periodKey} basePath="/sales" />
      </div>

      {missing.length > 0 && (
        <Link href="/sales/record/close" className={`${cardCls} mb-3 block border-red-300 bg-red-50/50`}>
          <h2 className={`${sectionHeadCls} text-red-700`}>Days not closed</h2>
          <p className="mt-1 text-sm font-medium text-red-800">
            {missing.length} {plural(missing.length, 'day')} sold food and never had{' '}
            {missing.length === 1 ? 'its' : 'their'} cash counted — {missing.slice(0, 5).map((d) => fmtDate(d)).join(' · ')}
          </p>
        </Link>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Revenue</h2>
            <span className="font-mono text-[10px] text-stone-400">sales_by_day</span>
          </div>
          <p className="mt-1.5 text-sm text-stone-700">
            {series.length === 0
              ? 'No sales fetched for this period yet.'
              : `${formatPaise(total)} across ${series.length} ${plural(series.length, 'day')}.`}
          </p>
          {series.length === 1 ? (
            <p className={`mt-1 text-[26px] ${heroNumCls} text-stone-900`}>
              {formatMoneyString(series[0].revenue)}
            </p>
          ) : (
            series.length > 1 && (
              <div className="mt-2">
                <SalesLine points={series} />
              </div>
            )
          )}
        </section>

        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Yesterday&apos;s drawer</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            {diff === null
              ? `${fmtDate(yesterday.date)} is not closed yet.`
              : diff === 0
                ? `${fmtDate(yesterday.date)} squared exactly.`
                : `${fmtDate(yesterday.date)} was out by ${formatPaise(Math.abs(diff))}.`}
          </p>
          {diff !== null && diff !== 0 && (
            <p className={`mt-1 text-[26px] ${heroNumCls} text-red-700`}>{formatPaise(diff)}</p>
          )}
          <Link
            href="/sales/record/close"
            className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline"
          >
            close a day →
          </Link>
        </section>

        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Effective GST</h2>
            <span className="font-mono text-[10px] text-stone-400">gst_service_by_day</span>
          </div>
          <p className={`mt-1 text-[26px] ${heroNumCls} text-stone-900`}>
            {effective === null ? '—' : `${effective.toFixed(2)}%`}
          </p>
          <p className="text-xs text-stone-600">
            GST belongs to the government, service charge to the staff — neither is revenue.
          </p>
          <Link
            href="/sales/books/gst"
            className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline"
          >
            the reconciliation →
          </Link>
        </section>

        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Unmapped POS revenue</h2>
          {unmapped.items === 0 ? (
            <p className="mt-1.5 text-sm text-stone-700">Everything sold is mapped to a dish.</p>
          ) : (
            <>
              <p className={`mt-1 text-[26px] ${heroNumCls} text-red-700`}>
                {formatMoneyString(unmapped.revenue)}
              </p>
              <div className="mt-2">
                <Honesty level="alarm" verdict="unclaimed" compact>
                  {unmapped.items} POS {plural(unmapped.items, 'item')} no dish claims, so this money belongs to
                  no department and no food cost.
                </Honesty>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  )
}
