import { getMasters, getRestaurant } from '@/server/queries'
import { listOtherIncome } from '@/server/cash-queries'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { getList, getNameHistory } from '@/server/settings'
import OtherIncomeForm from '@/components/cash/OtherIncomeForm'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function OtherIncomePage() {
  const restaurant = await getRestaurant()
  const [{ units }, accounts, items, buyerNames, receiverNames, rows] = await Promise.all([
    getMasters(),
    listMoneyAccounts(restaurant.id),
    getList(restaurant.id, 'other_income_item'),
    getNameHistory(restaurant.id, 'income_buyer'),
    getNameHistory(restaurant.id, 'income_received_by'),
    listOtherIncome(restaurant.id, 20),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Other income</h1>
        <p className={pageSubCls}>used oil, scrap, cartons — cash in that isn’t food</p>
      </header>

      <div className="space-y-4">
        <OtherIncomeForm units={units} accounts={accounts} items={items} buyerNames={buyerNames} receiverNames={receiverNames} />

        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Recent income</h2>
          {rows.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">Nothing yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-rule-soft">
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
    </>
  )
}
