import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { countUnmapped, getSalesDays, listUnknownOrders } from '@/server/sales-queries'
import FetchDay from '@/components/sales/FetchDay'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'
import Honesty from '@/components/Honesty'
import { businessToday, businessYesterday } from '@/server/business-day'
import OutsidePeriod from '@/components/dashboard/OutsidePeriod'
import ViewToggle from '@/components/ViewToggle'
import { readView, VIEW_KEYS } from '@/lib/views'
import { getSalesByHour, getSalesByItem } from '@/server/sales-queries'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { dataTableCls, tdCls, tdCodeCls, tdNumCls, thCls, thNumCls, trCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

// ONE DATASET, THREE QUESTIONS. By day is the ledger and the default. By hour
// shows the trading day — two services show as two humps, and that shape says
// more than the total. By item answers "what actually sold", and it reads POS
// item names straight from the lines rather than through pos_item_map: dish
// quantities need a mapping and are therefore silent about 94% of revenue
// today, while this works on day one and is the list somebody uses to DO the
// mapping.
const VIEWS = [
  { value: 'by-day' as const, label: 'By day', hint: 'Each business day, newest first — the ledger.' },
  { value: 'by-hour' as const, label: 'By hour', hint: 'The trading day. Two services show as two humps.' },
  { value: 'by-item' as const, label: 'By item', hint: 'What the till actually rang up — no mapping needed.' },
]

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; period?: string }>
}) {
  const { view: viewParam, period: periodParam } = await searchParams
  const view = readView('sales', viewParam)
  const periodToday = await businessToday()
  const period = resolvePeriod(readPeriodParam(periodParam, periodToday).param, periodToday)
  const restaurant = await getRestaurant()
  const [days, unmappedCount, unknownOrders, hours, items] = await Promise.all([
    getSalesDays(restaurant.id),
    countUnmapped(restaurant.id),
    listUnknownOrders(restaurant.id),
    view === 'by-hour' ? getSalesByHour(restaurant.id, period.from, period.to) : Promise.resolve([]),
    view === 'by-item' ? getSalesByItem(restaurant.id, period.from, period.to) : Promise.resolve([]),
  ])

  return (
    <section className="mt-4 space-y-4">
      <FetchDay defaultDate={await businessYesterday()} today={await businessToday()} />

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
      {/* ROSTER FORM, not the statement form: this page holds no period-scoped
          unmapped figure, and running a query purely to produce a sentence is
          not worth it. BOTH BRANCHES — "all mapped" read as a month is the
          all-clear fault, which is where a wrong scope does the most damage. */}
      <OutsidePeriod
        basis="all-time"
        what="The queue is every POS item ever seen, not this period's — a backlog, so the dates above do not narrow it."
      />

      <ViewToggle
        param="view"
        value={view}
        options={VIEWS}
        defaultValue={VIEW_KEYS.sales[0]}
        label="Which question to ask of the sales"
      />

      {view !== 'by-day' && (
        <PeriodControl basePath="/sales/books/sales" period={period} today={periodToday} />
      )}

      {view === 'by-hour' && (
        <div className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>The trading day</h2>
            <span className="text-xs text-stone-400">sales_by_hour</span>
          </div>
          {hours.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">
              No order in this period carried a time, so the hours cannot be read. That is a gap in what the
              POS sent, not a quiet night.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Hour</th>
                    <th className={thNumCls}>Orders</th>
                    <th className={thNumCls}>Covers</th>
                    <th className={thNumCls}>Revenue</th>
                    <th className={thNumCls}>Per cover</th>
                  </tr>
                </thead>
                <tbody>
                  {hours.map((h) => (
                    <tr key={h.hour} className={trCls}>
                      <td className={tdCodeCls}>{String(h.hour).padStart(2, '0')}:00</td>
                      <td className={tdNumCls}>{h.orders}</td>
                      <td className={tdNumCls}>{h.covers}</td>
                      <td className={tdNumCls}>{formatMoneyString(h.revenue)}</td>
                      <td className={tdNumCls}>
                        {h.per_cover === null ? (
                          <span className="text-stone-400">no covers</span>
                        ) : (
                          formatMoneyString(h.per_cover)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === 'by-item' && (
        <div className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>What sold</h2>
            <span className="text-xs text-stone-400">pos_lines · revenue orders only</span>
          </div>
          {items.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">
              Nothing was rung up in this period.
            </p>
          ) : (
            <>
              <div className="mt-2 overflow-x-auto">
                <table className={dataTableCls}>
                  <thead>
                    <tr>
                      <th className={thCls}>Item</th>
                      <th className={thNumCls}>Qty</th>
                      <th className={thNumCls}>Revenue</th>
                      <th className={thCls}>Mapped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.pos_item_id} className={trCls}>
                        <td className={tdCls}>{i.item_name}</td>
                        <td className={tdNumCls}>{i.qty}</td>
                        <td className={tdNumCls}>{formatMoneyString(i.revenue)}</td>
                        <td className={`${tdCls} text-xs`}>
                          {i.mapped ? (
                            <span className="text-stone-500">yes</span>
                          ) : (
                            <span className="text-doubt">not yet</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-stone-400">
                Read straight from the POS lines, so this works whether or not anything has been mapped — unlike
                dish quantities, which need a mapping and are silent about everything that has none.
              </p>
            </>
          )}
        </div>
      )}

      <div className={view === 'by-day' ? cardCls : 'hidden'}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Days</h2>
          <span className="text-xs text-stone-400">latest fetch per date wins · sales_by_day</span>
        </div>
        {/* THE SAME LEAD AS /owner's recent days, deliberately. Not because
            this strip misleads — "Days" is nearly self-describing — but
            because that one already says it and one vocabulary beats two. */}
        <OutsidePeriod
          basis="way-in"
          what="The last few days fetched, so there is always a door into one. The dates above scope what sold, not this list."
          className="mt-1"
        />
        {days.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            Nothing fetched yet. Pick a date above and press Fetch day — yesterday is the usual first pull.
          </p>
        ) : (
          <>
            {/* FIXED TRACKS ARE WHAT BROKE THE SECTIONS TABLE, and Revenue
                here was the next one due: 5.6rem is about 90px and the biggest
                day on record, ₹4,63,055.00, needs about 92. A festival day
                doubles it. A table sizes its columns to content ACROSS rows,
                which fixed tracks cannot and per-row `max-content` grids
                cannot either — they would size independently and stop lining
                up. The number never gives way; the table scrolls instead. */}
            <div className="mt-2 -mx-1 overflow-x-auto px-1">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Orders · covers</th>
                    <th className={`${thNumCls} hidden sm:table-cell`}>Cash</th>
                    <th className={thNumCls}>Flags</th>
                    <th className={thNumCls}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.business_date}>
                      <td className={`${tdCls} whitespace-nowrap text-stone-700`}>{fmtDate(d.business_date)}</td>
                      <td className={`${tdCls} whitespace-nowrap text-stone-600`}>
                        {d.orders} · {d.covers}
                        {d.fetch_count > 1 && (
                          <span className="ml-1.5 text-[11px] text-stone-400">fetched ×{d.fetch_count}</span>
                        )}
                      </td>
                      <td className={`${tdNumCls} hidden text-stone-500 sm:table-cell`}>
                        {formatMoneyString(d.cash_revenue)}
                      </td>
                      <td className={tdCls}>
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
                      </td>
                      <td className={`${tdNumCls} font-semibold text-stone-900`}>{formatMoneyString(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {unknownOrders.length > 0 && (
        <div>
          {/* ALL-TIME AND IT MUST STAY SO. An order the app cannot bank is in
              no total until somebody looks it up in Petpooja; letting the
              period hide one would be the open-short fault in a new costume —
              a finding from six weeks ago is still money in no column. */}
          <OutsidePeriod
            basis="all-time"
            what="Every order on record that this app could not bank, whatever the dates above say — one from six weeks ago is still in no total."
            className="mb-2"
          />
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
