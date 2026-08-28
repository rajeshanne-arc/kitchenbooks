// WHAT WAS PAID, AND TO WHOM — the destination of the store dashboard's
// "Paid out" card.
//
// A NUMBER YOU CAN CLICK IS A PROMISE THAT THE LIST BEHIND IT EXPLAINS THAT
// NUMBER, and the promise is kept two ways: this page reads the SAME ?period=
// the dashboard was showing, and the total below is asserted against the card's
// to the paise. A drill-down answering over a different window renders
// perfectly, looks plausible, and is wrong — nobody sums a page of payments by
// eye to catch it.

import { getRestaurant } from '@/server/queries'
import { listPaymentsLog } from '@/server/store-queries'
import { businessToday } from '@/server/business-day'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import {
  cardCls,
  dataTableCls,
  docNoCls,
  pageSubCls,
  pageTitleCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function PaymentsLogPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const restaurant = await getRestaurant()
  const periodToday = await businessToday()
  // ONE front door for ?period=, so preset/custom precedence is decided in one
  // place — twelve surfaces read it and a hand-written ternary here would be a
  // thirteenth chance to get the precedence wrong.
  const { period: periodParam } = await searchParams
  const periodReq = readPeriodParam(periodParam, periodToday)
  const period = resolvePeriod(periodReq.param, periodToday)

  const rows = await listPaymentsLog(restaurant.id, period.from, period.to)
  const total = rows.reduce((n, r) => n + decimalStringToPaise(r.amount), 0)

  return (
    <div className="mt-2">
      <header className="pb-3">
        <h1 className={pageTitleCls}>Paid out</h1>
        <p className={pageSubCls}>
          {period.label} · {fmtDate(period.from)} — {fmtDate(period.to)} · every vendor payment in the window
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
          <p className="text-sm text-stone-500">No vendor payment was recorded in this period.</p>
        </div>
      ) : (
        <section className={cardCls}>
          <div className="overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Doc</th>
                  <th className={thCls}>Vendor</th>
                  <th className={thCls}>Paid via</th>
                  <th className={thNumCls}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={trCls}>
                    <td className={tdCls}>{fmtDate(r.paid_date)}</td>
                    <td className={tdCodeCls}>
                      <span className={docNoCls}>{r.doc_no ?? '—'}</span>
                    </td>
                    <td className={tdCls}>
                      {r.vendor_name}
                      <span className="ml-1.5 font-mono text-[11px] text-stone-400">{r.vendor_code}</span>
                    </td>
                    <td className={tdCls}>
                      {r.mode ?? '—'}
                      {/* NAMED, NOT OMITTED. account_id is nullable because
                          history predates money accounts, and a blank column
                          would read as a payment from nowhere. */}
                      <span className="ml-1.5 text-[12px] text-stone-500">
                        {r.account_name ?? 'no account named'}
                      </span>
                    </td>
                    <td className={tdNumCls}>{formatMoneyString(r.amount)}</td>
                  </tr>
                ))}
                <tr className={trCls}>
                  <td className={`${tdCls} font-semibold`} colSpan={4}>
                    {rows.length} payment{rows.length === 1 ? '' : 's'}
                  </td>
                  <td className={`${tdNumCls} font-semibold`}>{formatPaise(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
