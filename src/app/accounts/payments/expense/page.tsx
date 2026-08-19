import { getRestaurant } from '@/server/queries'
import { listMoneyAccounts } from '@/server/accounts-queries'
import {
  getExpensesByCategory,
  getRecurringExpenseOffers,
  listExpenses,
} from '@/server/expenses-queries'
import { getList, getNameHistory } from '@/server/settings'
import ExpensesClient from '@/components/staff/ExpensesClient'
import { formatMoneyString } from '@/lib/money'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'
import { businessMonthStart } from '@/server/business-day'

export const dynamic = 'force-dynamic'

export default async function ExpensesPage() {
  const restaurant = await getRestaurant()
  const month = await businessMonthStart()
  const [accounts, categories, modes, payeeNames, rows, byCategory, recurring] = await Promise.all([
    listMoneyAccounts(restaurant.id),
    getList(restaurant.id, 'expense_category'),
    getList(restaurant.id, 'payment_mode'),
    getNameHistory(restaurant.id, 'expense_payee'),
    listExpenses(restaurant.id, 15),
    getExpensesByCategory(restaurant.id, month),
    getRecurringExpenseOffers(restaurant.id, month),
  ])
  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Expenses</h1>
        <p className={pageSubCls}>
          {restaurant.name} — rent, power, licences and the rest: the money that is neither food nor the
          drawer
        </p>
      </header>

      <div className="space-y-4">
        <ExpensesClient
          accounts={accounts}
          categories={categories}
          modes={modes}
          payeeNames={payeeNames}
          rows={rows}
          recurring={recurring}
        />

        {byCategory.length > 0 && (
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={sectionHeadCls}>This month by category</h2>
              <span className="text-xs text-stone-400">expenses_by_category</span>
            </div>
            <ul className="mt-1 divide-y divide-rule-soft">
              {byCategory.map((c) => (
                <li key={c.category} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-stone-900">{c.category}</span>
                  <span className="tabular-nums text-sm font-semibold text-stone-900">{formatMoneyString(c.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

      </div>
    </>
  )
}
