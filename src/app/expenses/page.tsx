import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import {
  getAttendanceMonthSummary,
  getExpensesByCategory,
  getLabourMonth,
  listExpenses,
} from '@/server/expenses-queries'
import { getList, getNameHistory } from '@/server/settings'
import { monthStartIST } from '@/server/store-queries'
import GroupTabs from '@/components/GroupTabs'
import ExpensesClient from '@/components/staff/ExpensesClient'
import { formatMoneyString } from '@/lib/money'
import { cardCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function ExpensesPage() {
  const restaurant = await getRestaurant()
  const month = monthStartIST()
  const [categories, modes, payeeNames, rows, byCategory, labour, attendance] = await Promise.all([
    getList(restaurant.id, 'expense_category'),
    getList(restaurant.id, 'payment_mode'),
    getNameHistory(restaurant.id, 'expense_payee'),
    listExpenses(restaurant.id, 15),
    getExpensesByCategory(restaurant.id, month),
    getLabourMonth(restaurant.id, month),
    getAttendanceMonthSummary(restaurant.id, month),
  ])
  const unassigned = labour.reduce((n, l) => n + l.unassigned_marks, 0)
  const unsalaried = labour.reduce((n, l) => n + l.unsalaried_marks, 0)

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Expenses</h1>
        <p className="mt-0.5 text-sm text-stone-400">{restaurant.name} — the money that isn’t food or the drawer</p>
      </header>
      <GroupTabs group="staff" />

      <div className="space-y-4">
        <ExpensesClient categories={categories} modes={modes} payeeNames={payeeNames} rows={rows} />

        {byCategory.length > 0 && (
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={sectionHeadCls}>This month by category</h2>
              <span className="text-xs text-stone-400">expenses_by_category</span>
            </div>
            <ul className="mt-1 divide-y divide-stone-100">
              {byCategory.map((c) => (
                <li key={c.category} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-stone-900">{c.category}</span>
                  <span className="tabular-nums text-sm font-semibold text-stone-900">{formatMoneyString(c.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Wages this month</h2>
            <Link href="/books/staff" className="text-xs font-medium text-emerald-700 hover:underline">
              roster →
            </Link>
          </div>
          {(unassigned > 0 || unsalaried > 0) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {unassigned > 0 && (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  {unassigned} marks on staff with no section
                </span>
              )}
              {unsalaried > 0 && (
                <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                  {unsalaried} marks on staff with no salary
                </span>
              )}
            </div>
          )}
          {labour.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No attendance marked this month yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-stone-100">
              {labour.map((l) => (
                <li key={l.section_code ?? '—'} className="flex items-center justify-between gap-3 py-2">
                  <span className={`text-sm ${l.section_code === null ? 'font-semibold text-amber-800' : 'text-stone-900'}`}>
                    {l.section_name ?? 'No section — unassigned'}
                  </span>
                  <span className="tabular-nums text-sm font-semibold text-stone-900">{formatMoneyString(l.labour_cost)}</span>
                </li>
              ))}
            </ul>
          )}
          {attendance.length > 0 && (
            <p className="mt-3 border-t border-stone-100 pt-2 text-xs text-stone-500">
              Attendance marks:{' '}
              {attendance.map((a, i) => (
                <span key={a.status}>
                  {i > 0 && ' · '}
                  <span className="font-medium text-stone-700">{a.marks}</span> {a.status}
                </span>
              ))}
            </p>
          )}
          <p className="mt-1 text-xs text-stone-400">
            pay law: present 1 · half 0.5 · off 1 (paid) · leave/absent 0 — contract staff billed by their vendor
          </p>
        </section>
      </div>
    </main>
  )
}
