// Output tax, day by day, exactly as the point of sale reported it.
//
// The columns belong to the view; the only thing added is the sum at the
// foot. `effective_gst_pct` is the VIEW's own division of tax by sale —
// printed, never recomputed here — and it is deliberately ABSENT from the
// total row. A single rate for a whole period would be a number this screen
// invented, and the average of days of different sizes is not the rate of
// any of them.
//
// The words stay neutral on purpose: "tax", "service", "container" are what
// the bill carried. Which of them is a tax, whose tax, and at what rate, is
// a question this app never answers.
import type { GstDayRow } from '@/lib/types'
import { formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty from '@/components/Honesty'
import {
  cardCls,
  dataTableCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export default function OutputTax({
  days,
  totals,
  from,
  to,
}: {
  days: GstDayRow[]
  /** worked out once by the page, so the foot and every other card agree */
  totals: { sale: number; tax: number; service: number; container: number }
  from: string
  to: string
}) {
  const rated = days.filter((d) => d.effective_gst_pct !== null).length

  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Collected on sales</h2>
        <span className="font-mono text-[10px] text-stone-400">gst_service_by_day</span>
      </div>

      {days.length === 0 ? (
        <p className="mt-1.5 text-sm text-stone-700">
          No day between {fmtDate(from)} and {fmtDate(to)} has been fetched from the point of sale.
          An empty period is a real answer, not a failure — it fills in as days are fetched, and
          until then this screen has nothing to add up rather than a zero to defend.
        </p>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={thNumCls}>Sale</th>
                  <th className={thNumCls}>Tax</th>
                  <th className={thNumCls}>Service</th>
                  <th className={thNumCls}>Container</th>
                  <th className={thNumCls}>Rate</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.business_date} className={trCls}>
                    <td className={tdCls}>{fmtDate(d.business_date)}</td>
                    <td className={tdNumCls}>{formatMoneyString(d.food_bev)}</td>
                    <td className={tdNumCls}>{formatMoneyString(d.gst_collected)}</td>
                    <td className={tdNumCls}>{formatMoneyString(d.service_charge)}</td>
                    <td className={tdNumCls}>{formatMoneyString(d.container)}</td>
                    <td className={tdNumCls}>
                      {d.effective_gst_pct === null ? (
                        <span className="text-stone-300">—</span>
                      ) : (
                        `${d.effective_gst_pct}%`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={`${tdCls} font-medium text-stone-500`}>
                    {days.length} {days.length === 1 ? 'day' : 'days'}
                  </td>
                  <td className={`${tdNumCls} font-semibold`}>{formatPaise(totals.sale)}</td>
                  <td className={`${tdNumCls} font-semibold`}>{formatPaise(totals.tax)}</td>
                  <td className={`${tdNumCls} font-semibold`}>{formatPaise(totals.service)}</td>
                  <td className={`${tdNumCls} font-semibold`}>{formatPaise(totals.container)}</td>
                  <td className={`${tdNumCls} text-stone-300`}>—</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {rated < days.length && (
            <div className="mt-3">
              <Honesty
                verdict="no rate stated"
                meter={{ filled: rated, total: days.length, unit: 'days with a rate' }}
              >
                {days.length - rated} of these {days.length} days state no rate, because they
                recorded no sale to take a percentage of. The tax and service figures beside them
                are still real; only the division is missing.
              </Honesty>
            </div>
          )}

          <p className="mt-3 text-xs text-stone-500">
            The rate column is the view&apos;s own division of tax by sale, one day at a time. There
            is no rate for the period as a whole: averaging days of different sizes produces a
            figure that describes none of them, so the total row leaves it blank rather than fill
            it.
          </p>
          <p className="mt-1.5 text-xs text-stone-500">
            Service and container charges sit on the same bill and are neither sale nor tax. They
            are printed here so nobody has to guess which column they fell into.
          </p>
        </>
      )}
    </section>
  )
}
