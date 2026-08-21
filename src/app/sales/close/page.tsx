import { getRestaurant } from '@/server/queries'
import { getClosePrefill, getLadder } from '@/server/cash-queries'
import { getDifferenceTrend } from '@/server/cashier-queries'
import { getNameHistory } from '@/server/settings'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { getUnreadMeters, listReadableMeters } from '@/server/meters-queries'
import DayClose from '@/components/cash/DayClose'
import MeterReadingEntry from '@/components/meters/MeterReadingEntry'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

export default async function CashPage() {
  const restaurant = await getRestaurant()
  const today = await businessToday()
  const [prefill, handedToNames, trend, ladder, accounts, meters, unread] = await Promise.all([
    getClosePrefill(restaurant.id, today),
    getNameHistory(restaurant.id, 'handed_to'),
    getDifferenceTrend(restaurant.id, 14),
    getLadder(restaurant.id, 7),
    listMoneyAccounts(restaurant.id),
    // UTILITIES DO NOT BELONG TO SALES. What puts a meter reading on this
    // screen is that somebody is already standing here at a fixed time every
    // night — the same principle as the cash voucher: whoever is physically
    // there records it. It is a SEPARATE card with a SEPARATE save, above the
    // close and outside its form, so a forgotten meter can never hold up the
    // nightly cash close, which has a hard chain of its own.
    listReadableMeters(restaurant.id),
    getUnreadMeters(restaurant.id, today),
  ])
  // Only meters that may actually be read tonight; a mode edited in the
  // database must not leave an unread nag for a meter nobody may file against.
  const readableIds = new Set(meters.map((m) => m.id))
  const unreadReadable = unread.filter((m) => readableIds.has(m.id))

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Cash</h1>
        <p className={pageSubCls}>{restaurant.name} — the cashier’s day</p>
      </header>

      <div className="space-y-4">
        <DayClose defaultDate={today} initialPrefill={prefill} restaurantName={restaurant.name} handedToNames={handedToNames} accounts={accounts} />

        {/* Renders NOTHING when no meter is set up — this restaurant is on
            cylinders and does not meter electricity, which is the ordinary
            state and not a gap. */}
        <MeterReadingEntry meters={meters} unread={unreadReadable} date={today} />

        {trend.length > 0 && (
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={sectionHeadCls}>Difference trend</h2>
              <span className="text-xs text-stone-400">recent closes · day_close_ladder</span>
            </div>
            <div className="mt-2 flex items-end gap-1.5 overflow-x-auto pb-1">
              {trend.map((t) => {
                const diff = decimalStringToPaise(t.difference)
                return (
                  <div key={t.close_date} className="flex shrink-0 flex-col items-center gap-1">
                    <span
                      className={`rounded px-1.5 py-1 text-[11px] font-semibold tabular-nums ${
                        diff === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {diff === 0 ? '0' : formatMoneyString(t.difference)}
                    </span>
                    <span className="text-[10px] text-stone-400">{t.close_date.slice(8)}</span>
                  </div>
                )
              })}
            </div>
            <p className="mt-1 text-xs text-stone-400">red on any non-zero difference — it belongs to its day</p>
          </section>
        )}

        {ladder.length > 0 && (
          <section className={cardCls}>
            <h2 className={sectionHeadCls}>Recent closes</h2>
            <ul className="mt-1 divide-y divide-rule-soft">
              {ladder.map((l) => {
                const diff = decimalStringToPaise(l.difference)
                return (
                  <li key={l.close_date} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-stone-900">
                      {fmtDate(l.close_date)}
                      {l.filings > 1 && <span className="ml-1.5 text-xs text-amber-700">corrected ×{l.filings - 1}</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums text-sm text-stone-500">counted {formatMoneyString(l.cash_counted)}</span>
                      <span className={`tabular-nums text-sm font-semibold ${diff === 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {formatMoneyString(l.difference)}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}
