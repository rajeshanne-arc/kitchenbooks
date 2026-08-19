import { getRestaurant } from '@/server/queries'
import { getDailyPurchases } from '@/server/reports-queries'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import {
  cardCls, dataTableCls, pageSubCls, pageTitleCls, sectionHeadCls,
  tdCls, tdCodeCls, tdNumCls, thCls, thNumCls, trCls,
} from '@/components/ui'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { SalesLine } from '@/components/dashboard/Charts'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

// Spend by day, grouped by vendor — the trip ledger read backwards. The
// chart answers "which days cost me", the table answers "and to whom".

export default async function DailyPurchasesPage({
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
  const rows = await getDailyPurchases(restaurant.id, period.from, period.to)

  const byDay = new Map<string, number>()
  for (const r of rows) byDay.set(r.bill_date, (byDay.get(r.bill_date) ?? 0) + decimalStringToPaise(r.spend))
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const total = days.reduce((n, [, v]) => n + v, 0)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Daily purchases</h1>
        <p className={pageSubCls}>{restaurant.name} — {period.label}</p>
      </header>

      <div className="pb-4">
        <PeriodControl period={period} error={periodReq.error} basePath="/store/books/purchases" />
      </div>

      {rows.length === 0 ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>No bills</h2>
          <p className="mt-1.5 text-sm text-stone-700">Nothing was bought in this period.</p>
        </section>
      ) : (
        <div className="space-y-4">
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={sectionHeadCls}>Spend</h2>
              <span className="font-mono text-[10px] text-stone-400">daily_purchases</span>
            </div>
            <p className="mt-1.5 text-sm text-stone-700">
              {formatPaise(total)} across {days.length} {days.length === 1 ? 'day' : 'days'}.
            </p>
            {days.length > 1 && (
              <div className="mt-2">
                <SalesLine
                  points={days.map(([d, v]) => ({ date: d, revenue: (v / 100).toFixed(2), orders: 0 }))}
                />
              </div>
            )}
          </section>

          <section className={cardCls}>
            <h2 className={sectionHeadCls}>By day and vendor</h2>
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Vendor</th>
                    <th className={thCls}>Code</th>
                    <th className={thNumCls}>Bills</th>
                    <th className={thNumCls}>Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.bill_date}-${r.vendor_code}-${i}`} className={trCls}>
                      <td className={tdCls}>{fmtDate(r.bill_date)}</td>
                      <td className={tdCls}>{r.vendor_name}</td>
                      <td className={tdCodeCls}>{r.vendor_code}</td>
                      <td className={`${tdNumCls} text-stone-500`}>{r.bills}</td>
                      <td className={`${tdNumCls} font-semibold`}>{formatMoneyString(r.spend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
