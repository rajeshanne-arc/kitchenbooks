import { getRestaurant } from '@/server/queries'
import { getPriceMovements } from '@/server/store-queries'
import { businessToday } from '@/server/business-day'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty from '@/components/Honesty'
import {
  cardCls,
  dataTableCls,
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

// WHAT A VENDOR'S PRICE DID — the report half of price variance. The bill form
// says it while somebody is typing; this says it for a period, after the fact,
// which is a different question and a different reader.
//
// ORDERED BY WHAT THE MOVE COST, not by percentage. A 40% rise on a ₹20 item
// matters less than a 6% rise on the chicken, and the ordering is the report's
// whole argument — cost_of_change is qty × the difference, what the rise
// actually cost on that delivery.
//
// EVERY MOVE, NOT ONLY THE ONES THAT TRIPPED THE INLINE WARNING. The threshold
// exists so a form does not cry wolf at somebody mid-entry; a report is read
// deliberately, by somebody asking what changed, and a filtered one would hide
// the slow drift that never trips anything. Live proof: RR Chicken went ₹310 →
// ₹330 on Chicken Boneless, 6.5% — under the 10% threshold, invisible until
// this existed, and it cost ₹200 on one delivery.

export default async function PriceMovesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  const today = await businessToday()
  const periodReq = readPeriodParam(periodParam, today)
  const period = resolvePeriod(periodReq.param, today)
  const restaurant = await getRestaurant()
  const { rows, firstPurchases } = await getPriceMovements(restaurant.id, period.from, period.to)

  const rises = rows.filter((r) => Number(r.change_value) > 0)
  const costOfRises = rises.reduce((n, r) => n + Number(r.cost_of_change ?? 0), 0)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Price moves</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what each vendor charged against what they last charged, for the same item.
          Never against another vendor: the same chicken is ₹330 from one and ₹300 from another, and an
          average would call both of them wrong.
        </p>
      </header>

      <PeriodControl period={period} today={today} basePath="/store/books/prices" error={periodReq.error} />

      <section className={`${cardCls} mt-3`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
            {rows.length === 0 ? 'No price moved' : `${rows.length} price ${rows.length === 1 ? 'move' : 'moves'}`}
          </h2>
          <span className="font-mono text-[11px] text-stone-400">price_movements</span>
        </div>

        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">
            No vendor changed a price in this period — or no item was bought twice from the same vendor in it,
            which is the more likely reading on a young book. A price cannot move until somebody has been
            billed for the same thing twice.
          </p>
        ) : (
          <>
            {rises.length > 0 && (
              <p className="mt-1 text-sm text-stone-700">
                {rises.length === 1
                  ? 'One price went up'
                  : `${rises.length} prices went up`}
                , costing <b className="font-mono tabular-nums">{formatMoneyString(String(costOfRises))}</b> on
                the deliveries they landed on.
              </p>
            )}
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Item</th>
                    <th className={thCls}>Vendor</th>
                    <th className={thCls}>When</th>
                    <th className={thNumCls}>Was</th>
                    <th className={thNumCls}>Now</th>
                    <th className={thNumCls}>Move</th>
                    <th className={thNumCls}>Cost of it</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const up = Number(r.change_value) > 0
                    return (
                      <tr key={`${r.item_code}-${r.bill_date}-${i}`} className={trCls}>
                        <td className={tdCls}>
                          {r.item_name}
                          <span className={`${tdCodeCls} border-0 p-0`}> {r.item_code}</span>
                        </td>
                        <td className={`${tdCls} text-stone-600`}>{r.vendor_name}</td>
                        <td className={`${tdCls} text-stone-600`}>
                          {fmtDate(r.bill_date)}
                          {r.previous_date !== null && (
                            <span className="block text-[11px] text-stone-400">
                              was {fmtDate(r.previous_date)}
                            </span>
                          )}
                        </td>
                        <td className={tdNumCls}>{formatMoneyString(r.previous_rate ?? '0')}</td>
                        <td className={tdNumCls}>{formatMoneyString(r.rate)}</td>
                        {/* THE WORD AND THE SIGN, NOT COLOUR ALONE — the gap
                            rule, applied to money. */}
                        <td className={`${tdNumCls} font-semibold ${up ? 'text-red-700' : 'text-emerald-700'}`}>
                          {up ? 'up' : 'down'} {Math.abs(Number(r.change_pct ?? 0))}%
                        </td>
                        <td className={`${tdNumCls} ${up ? 'text-red-700' : 'text-emerald-700'}`}>
                          {up ? '+' : '−'}
                          {formatMoneyString(String(Math.abs(Number(r.cost_of_change ?? 0))))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* NOT A MOVE, AND SAID RATHER THAN SILENTLY DROPPED. A first purchase
            from a vendor has nothing to compare against; leaving it out
            without a word would make the list look like the whole of what was
            bought. */}
        {firstPurchases > 0 && (
          <div className="mt-3">
            <Honesty verdict="nothing to compare" compact>
              {firstPurchases} {firstPurchases === 1 ? 'line was' : 'lines were'} the first time that vendor
              billed that item, so {firstPurchases === 1 ? 'it has' : 'they have'} no previous price and{' '}
              {firstPurchases === 1 ? 'is' : 'are'} not in the table. That is not a price of zero — it is a
              price with no history behind it yet.
            </Honesty>
          </div>
        )}
      </section>
    </>
  )
}
