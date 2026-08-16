import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { countUnmapped, getSalesDays, listUnknownOrders } from '@/server/sales-queries'
import FetchDay from '@/components/sales/FetchDay'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'
import Honesty from '@/components/Honesty'
import { businessYesterday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

export default async function SalesPage() {
  const restaurant = await getRestaurant()
  const [days, unmappedCount, unknownOrders] = await Promise.all([
    getSalesDays(restaurant.id),
    countUnmapped(restaurant.id),
    listUnknownOrders(restaurant.id),
  ])

  return (
    <section className="mt-4 space-y-4">
      <FetchDay defaultDate={await businessYesterday()} />

      <Link
        href="/sales/books/sales/mapping"
        className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 shadow-sm hover:border-emerald-400"
      >
        <span className="text-[15px] font-medium text-stone-900">Map POS items to dishes</span>
        {unmappedCount > 0 ? (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            {unmappedCount} unmapped
          </span>
        ) : (
          <span className="text-xs text-stone-400">all mapped</span>
        )}
      </Link>

      <div className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Days</h2>
          <span className="text-xs text-stone-400">latest fetch per date wins · sales_by_day</span>
        </div>
        {days.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            Nothing fetched yet. Pick a date above and press Fetch day — yesterday is the usual first pull.
          </p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-[5.4rem_minmax(0,1fr)_4.4rem_5.6rem] gap-2 border-b border-stone-200 pb-1.5 sm:grid-cols-[6rem_minmax(0,1fr)_4.4rem_5.2rem_5.6rem]">
              <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Date</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Orders · covers</span>
              <span className="hidden text-right text-[11px] font-medium uppercase tracking-wide text-stone-400 sm:block">
                Cash
              </span>
              <span className="text-right text-[11px] font-medium uppercase tracking-wide text-stone-400">Flags</span>
              <span className="text-right text-[11px] font-medium uppercase tracking-wide text-stone-400">Revenue</span>
            </div>
            <ul className="divide-y divide-rule-soft">
              {days.map((d) => (
                <li
                  key={d.business_date}
                  className="grid grid-cols-[5.4rem_minmax(0,1fr)_4.4rem_5.6rem] items-center gap-2 py-2.5 sm:grid-cols-[6rem_minmax(0,1fr)_4.4rem_5.2rem_5.6rem]"
                >
                  <span className="text-sm text-stone-700">{fmtDate(d.business_date)}</span>
                  <span className="text-sm text-stone-600">
                    {d.orders} · {d.covers}
                    {d.fetch_count > 1 && (
                      <span className="ml-1.5 text-[11px] text-stone-400">fetched ×{d.fetch_count}</span>
                    )}
                  </span>
                  <span className="hidden text-right text-sm tabular-nums text-stone-500 sm:block">
                    {formatMoneyString(d.cash_revenue)}
                  </span>
                  <span className="flex flex-wrap justify-end gap-1">
                    {d.comps > 0 && (
                      <span
                        title={`${d.comps} comped orders worth ${formatMoneyString(d.comp_value)} — out of money, in orders and covers`}
                        className="rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800"
                      >
                        {d.comps} comp
                      </span>
                    )}
                    {d.cancelled > 0 && (
                      <span className="rounded-full border border-stone-300 bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-600">
                        {d.cancelled} canc
                      </span>
                    )}
                    {d.unknown_status > 0 && (
                      <span className="rounded-full border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-700">
                        {d.unknown_status} unknown
                      </span>
                    )}
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums text-stone-900">
                    {formatMoneyString(d.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {unknownOrders.length > 0 && (
        <div>
          <Honesty level="alarm" verdict="not banked">
            {unknownOrders.length === 1 ? 'This order carries' : 'These orders carry'} a status this app does not
            know, so {unknownOrders.length === 1 ? 'it is' : 'they are'} in no total — not revenue, not cancelled,
            not comped. Look {unknownOrders.length === 1 ? 'it' : 'them'} up in Petpooja.
          </Honesty>
          <ul className="mt-2 space-y-1 font-mono text-xs text-red-900">
            {unknownOrders.map((u) => (
              <li key={`${u.business_date}:${u.pos_order_id}`}>
                {fmtDate(u.business_date)} · #{u.pos_order_id} · “{u.status_raw}”
                {u.order_total !== null && <> · {formatMoneyString(u.order_total)}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-stone-400">
        Comps are out of the money but in orders and covers — a comped KOT still loaded the kitchen. Cancelled and
        unknown are counted separately and never join revenue.
      </p>
    </section>
  )
}
