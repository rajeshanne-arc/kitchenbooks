import { getRestaurant } from '@/server/queries'
import { getCashHandovers } from '@/server/reports-queries'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { isPeriodKey, resolvePeriod, type PeriodKey } from '@/lib/period'
import {
  cardCls, dataTableCls, pageSubCls, pageTitleCls, sectionHeadCls,
  tdCls, tdNumCls, thCls, thNumCls, trCls,
} from '@/components/ui'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

// Who took how much out of the drawer. cash_handovers reads day_closes'
// handed_to/handed_over, so this is not a new record — it is the same
// filing, asked the other way round: by person instead of by day.

export default async function HandoversPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : 'this-month'
  const period = resolvePeriod(periodKey, await businessToday())
  const restaurant = await getRestaurant()
  const rows = await getCashHandovers(restaurant.id, period.from, period.to)

  const byPerson = new Map<string, number>()
  for (const r of rows) {
    byPerson.set(r.person, (byPerson.get(r.person) ?? 0) + decimalStringToPaise(r.amount))
  }
  const people = [...byPerson.entries()].sort((a, b) => b[1] - a[1])
  const total = people.reduce((n, [, v]) => n + v, 0)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Cash handovers</h1>
        <p className={pageSubCls}>{restaurant.name} — {period.label}</p>
      </header>

      <div className="pb-4">
        <PeriodControl active={periodKey} basePath="/sales/books/handovers" />
      </div>

      {rows.length === 0 ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Nothing handed over</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            No day close in this period records cash leaving the drawer to a person.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={sectionHeadCls}>By person, period to date</h2>
              <span className="font-mono text-[10px] text-stone-400">cash_handovers</span>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Person</th>
                    <th className={thNumCls}>Times</th>
                    <th className={thNumCls}>Total taken</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map(([person, amount]) => (
                    <tr key={person} className={trCls}>
                      <td className={`${tdCls} font-medium`}>{person}</td>
                      <td className={`${tdNumCls} text-stone-500`}>
                        {rows.filter((r) => r.person === person).length}
                      </td>
                      <td className={`${tdNumCls} font-semibold`}>{formatPaise(amount)}</td>
                    </tr>
                  ))}
                  <tr className="h-11 border-t-2 border-rule">
                    <td className={`${tdCls} font-semibold`}>All</td>
                    <td className={tdNumCls} />
                    <td className={`${tdNumCls} font-bold`}>{formatPaise(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className={cardCls}>
            <h2 className={sectionHeadCls}>Day by day</h2>
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Handed to</th>
                    <th className={thNumCls}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.close_date}-${r.person}-${i}`} className={trCls}>
                      <td className={tdCls}>{fmtDate(r.close_date)}</td>
                      <td className={tdCls}>{r.person}</td>
                      <td className={tdNumCls}>{formatMoneyString(r.amount)}</td>
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
