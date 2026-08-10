import { getMasters, getRestaurant } from '@/server/queries'
import { listOtherIncome } from '@/server/cash-queries'
import { getList, getNameHistory } from '@/server/settings'
import GroupTabs from '@/components/GroupTabs'
import OtherIncomeForm from '@/components/cash/OtherIncomeForm'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function OtherIncomePage() {
  const restaurant = await getRestaurant()
  const [{ units }, items, buyerNames, receiverNames, rows] = await Promise.all([
    getMasters(),
    getList(restaurant.id, 'other_income_item'),
    getNameHistory(restaurant.id, 'income_buyer'),
    getNameHistory(restaurant.id, 'income_received_by'),
    listOtherIncome(restaurant.id, 20),
  ])

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Other income</h1>
        <p className="mt-0.5 text-sm text-stone-400">used oil, scrap, cartons — cash in that isn’t food</p>
      </header>
      <GroupTabs group="cashier" />

      <div className="space-y-4">
        <OtherIncomeForm units={units} items={items} buyerNames={buyerNames} receiverNames={receiverNames} />

        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Recent income</h2>
          {rows.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">Nothing yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-stone-100">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-stone-900">
                      {r.item}
                      {r.qty !== null && ` · ${r.qty} ${r.unit}`}
                      {r.buyer !== null && ` · to ${r.buyer}`}
                    </span>
                    <span className="block text-xs text-stone-500">{fmtDate(r.income_date)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-sm font-semibold text-stone-900">
                    {formatMoneyString(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
