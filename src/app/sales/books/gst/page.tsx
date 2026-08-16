import { getRestaurant } from '@/server/queries'
import { getGstServiceByDay } from '@/server/reports-queries'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { isPeriodKey, resolvePeriod, type PeriodKey } from '@/lib/period'
import {
  cardCls,
  dataTableCls,
  heroNumCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import PeriodControl from '@/components/dashboard/PeriodControl'
import Honesty from '@/components/Honesty'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

// GST and service charge, from gst_service_by_day.
//
// The effective rate is the point. Rajesh runs this reconciliation on paper
// already — his sheet lands around 4.9% against an expected 5%, and the
// difference is worth explaining rather than rounding away.
//
// NEITHER OF THESE IS REVENUE, and the page says so where it cannot be
// missed: GST is collected for the government, service charge is collected
// for the staff. Both pass through the till and neither belongs to the
// restaurant.

const EXPECTED_GST_PCT = 5

export default async function GstPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : 'this-month'
  const period = resolvePeriod(periodKey, await businessToday())
  const restaurant = await getRestaurant()
  const rows = await getGstServiceByDay(restaurant.id, period.from, period.to)

  const foodBev = rows.reduce((n, r) => n + decimalStringToPaise(r.food_bev), 0)
  const gst = rows.reduce((n, r) => n + decimalStringToPaise(r.gst_collected), 0)
  const service = rows.reduce((n, r) => n + decimalStringToPaise(r.service_charge), 0)
  const container = rows.reduce((n, r) => n + decimalStringToPaise(r.container), 0)
  const effective = foodBev > 0 ? (gst / foodBev) * 100 : null
  const drift = effective === null ? null : effective - EXPECTED_GST_PCT

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>GST &amp; service charge</h1>
        <p className={pageSubCls}>
          {restaurant.name} — {period.label}
        </p>
      </header>

      <div className="pb-4">
        <PeriodControl active={periodKey} basePath="/sales/books/gst" />
      </div>

      <p className="mb-4 rounded-xl border border-rule bg-stone-50 px-3 py-2 text-sm text-stone-700">
        GST belongs to the government. Service charge belongs to the staff. Neither is revenue — both pass
        through the till on their way somewhere else.
      </p>

      {rows.length === 0 ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Nothing to reconcile</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            No sales day in this period has been fetched, so there is no GST to check.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={sectionHeadCls}>Effective GST rate</h2>
              <span className="font-mono text-[10px] text-stone-400">gst_service_by_day</span>
            </div>
            <p
              className={`mt-1 text-[32px] ${heroNumCls} ${
                drift === null ? 'text-stone-400' : Math.abs(drift) > 0.25 ? 'text-amber-800' : 'text-stone-900'
              }`}
            >
              {effective === null ? 'not stated' : `${effective.toFixed(2)}%`}
            </p>
            <p className="text-xs text-stone-600">
              {formatPaise(gst)} collected on {formatPaise(foodBev)} of food &amp; bev · expected{' '}
              {EXPECTED_GST_PCT}%
            </p>
            {drift !== null && Math.abs(drift) > 0.25 && (
              <div className="mt-2">
                <Honesty verdict={drift < 0 ? 'under' : 'over'} compact>
                  {Math.abs(drift).toFixed(2)} points {drift < 0 ? 'below' : 'above'} the expected{' '}
                  {EXPECTED_GST_PCT}%. Exempt items, comped orders and rounding all pull this down — the number
                  is stated, not explained, and the explanation is the reconciliation.
                </Honesty>
              </div>
            )}
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-rule-soft pt-3">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Service charge</div>
                <div className="font-mono text-lg font-semibold tabular-nums text-stone-900">
                  {formatPaise(service)}
                </div>
                <div className="text-[11px] text-stone-500">to the staff</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Container</div>
                <div className="font-mono text-lg font-semibold tabular-nums text-stone-900">
                  {formatPaise(container)}
                </div>
                <div className="text-[11px] text-stone-500">packaging recovered</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Food &amp; bev</div>
                <div className="font-mono text-lg font-semibold tabular-nums text-stone-900">
                  {formatPaise(foodBev)}
                </div>
                <div className="text-[11px] text-stone-500">the only revenue here</div>
              </div>
            </div>
          </section>

          <section className={cardCls}>
            <h2 className={sectionHeadCls}>Day by day</h2>
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Date</th>
                    <th className={thNumCls}>Food &amp; bev</th>
                    <th className={thNumCls}>GST</th>
                    <th className={thNumCls}>Service</th>
                    <th className={thNumCls}>Container</th>
                    <th className={thNumCls}>Effective</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const pct = r.effective_gst_pct === null ? null : Number(r.effective_gst_pct)
                    return (
                      <tr key={r.business_date} className={trCls}>
                        <td className={tdCls}>{fmtDate(r.business_date)}</td>
                        <td className={tdNumCls}>{formatMoneyString(r.food_bev)}</td>
                        <td className={tdNumCls}>{formatMoneyString(r.gst_collected)}</td>
                        <td className={tdNumCls}>{formatMoneyString(r.service_charge)}</td>
                        <td className={tdNumCls}>{formatMoneyString(r.container)}</td>
                        <td
                          className={`${tdNumCls} font-semibold ${
                            pct === null
                              ? 'text-stone-400'
                              : Math.abs(pct - EXPECTED_GST_PCT) > 0.25
                                ? 'text-amber-800'
                                : 'text-stone-900'
                          }`}
                        >
                          {pct === null ? '—' : `${pct.toFixed(2)}%`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-stone-400">
              A dash means there was no food &amp; bev to divide by — never a rate of zero.
            </p>
          </section>
        </div>
      )}
    </>
  )
}
