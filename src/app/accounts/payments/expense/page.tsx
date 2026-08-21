import { getRestaurant } from '@/server/queries'
import { listMoneyAccounts } from '@/server/accounts-queries'
import {
  getExpensesByCategory,
  getRecurringExpenseOffers,
  listExpenses,
} from '@/server/expenses-queries'
import { getList, getNameHistory } from '@/server/settings'
import { getConsumptionTotals } from '@/server/meters-queries'
import ExpensesClient from '@/components/staff/ExpensesClient'
import Honesty from '@/components/Honesty'
import { formatMoneyString } from '@/lib/money'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'
import { businessMonthStart, businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

export default async function ExpensesPage() {
  const restaurant = await getRestaurant()
  const [month, today] = await Promise.all([businessMonthStart(), businessToday()])
  const [accounts, categories, modes, payeeNames, rows, byCategory, recurring, meters] = await Promise.all([
    listMoneyAccounts(restaurant.id),
    getList(restaurant.id, 'expense_category'),
    getList(restaurant.id, 'payment_mode'),
    getNameHistory(restaurant.id, 'expense_payee'),
    listExpenses(restaurant.id, 15),
    getExpensesByCategory(restaurant.id, month),
    getRecurringExpenseOffers(restaurant.id, month),
    // THE RECONCILIATION MOMENT. "rent, power, licences" — the real
    // electricity bill is entered on this screen, so the meter's estimate
    // belongs beside it rather than two groups away. Both roles who can open
    // /accounts can also open /owner/meters, so the link below is a literal
    // and audit:matrix checks it like any other.
    getConsumptionTotals(restaurant.id, month, today),
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

        {/* Silent when no meter has been read — most restaurants have none,
            and a permanent empty card is a thing people learn to skip. */}
        {meters.length > 0 && (
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={sectionHeadCls}>What the meters say this month</h2>
              <span className="text-xs text-stone-400">meter_consumption</span>
            </div>
            <ul className="mt-1 divide-y divide-rule-soft">
              {meters.map((m) => (
                <li key={m.meter_id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-sm text-stone-900">
                    {m.name}
                    <span className="ml-1.5 text-[11px] text-stone-400">
                      {m.units === null
                        ? `${m.readings} reading${m.readings === 1 ? '' : 's'}, nothing to compare yet`
                        : `${m.units} ${m.unit} across ${m.days_covered} day${m.days_covered === 1 ? '' : 's'} measured`}
                    </span>
                  </span>
                  <span className="tabular-nums text-sm font-semibold text-stone-900">
                    {m.estimated_cost === null ? '—' : formatMoneyString(m.estimated_cost)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <Honesty
                verdict="an estimate, not a bill"
                action={{ href: '/owner/meters', label: 'Meters and their rates' }}
              >
                Units × the rate typed on each meter. Electricity is slabbed, so the true unit cost
                depends on the month&apos;s total and is not known until the bill arrives — hold the
                bill up against this, never the other way round. The days shown are the days actually
                spanned by readings, which is less than the month wherever a night was missed; the
                figures are <b>not</b> scaled up to cover it.
              </Honesty>
            </div>
            {meters.some((m) => m.no_rate) && (
              <div className="mt-3">
                <Honesty verdict="no rate set">
                  {meters.filter((m) => m.no_rate).map((m) => m.name).join(', ')} {meters.filter((m) => m.no_rate).length === 1 ? 'has' : 'have'} no
                  rate per unit, so {meters.filter((m) => m.no_rate).length === 1 ? 'its units are' : 'their units are'} recorded and no rupee figure is.
                  Setting the rate is what turns those readings into something a bill can be checked
                  against.
                </Honesty>
              </div>
            )}
          </section>
        )}

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
