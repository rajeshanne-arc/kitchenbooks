import { getRestaurant } from '@/server/queries'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { getOwnerNames, getOwnersOwed, listVouchers } from '@/server/cash-queries'
import { getVoucherCategorySummary } from '@/server/cashier-queries'
import { getList, getNameHistory } from '@/server/settings'
import VoucherForm from '@/components/cash/VoucherForm'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'
import { businessMonthStart } from '@/server/business-day'

export const dynamic = 'force-dynamic'

export default async function VouchersPage() {
  const restaurant = await getRestaurant()
  const [ownerNames, categories, paidToNames, vouchers, byCategory, owed, accounts] = await Promise.all([
    getOwnerNames(restaurant.id),
    getList(restaurant.id, 'voucher_category'),
    getNameHistory(restaurant.id, 'voucher_paid_to'),
    listVouchers(restaurant.id, 15),
    getVoucherCategorySummary(restaurant.id, await businessMonthStart()),
    getOwnersOwed(restaurant.id),
    listMoneyAccounts(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Vouchers</h1>
        <p className={pageSubCls}>money out of the drawer — or out of an owner’s pocket</p>
      </header>

      <div className="space-y-4">
        <VoucherForm
          ownerNames={ownerNames}
          categories={categories}
          paidToNames={paidToNames}
          accounts={accounts}
        />

        {byCategory.length > 0 && (
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={sectionHeadCls}>This month by category</h2>
              <span className="text-xs text-stone-400">cashier-paid only</span>
            </div>
            <ul className="mt-1 divide-y divide-rule-soft">
              {byCategory.map((c) => (
                <li key={c.category} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-stone-900">
                    {c.category.replace(/_/g, ' ')} <span className="text-xs text-stone-400">×{c.entries}</span>
                  </span>
                  <span className="tabular-nums text-sm font-semibold text-stone-900">{formatMoneyString(c.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {owed.length > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-amber-800">Owners owed</h2>
            <ul className="mt-1 divide-y divide-amber-200/60">
              {owed.map((o) => (
                <li key={o.person} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-stone-900">{o.person}</span>
                  <span className="tabular-nums text-sm font-semibold text-amber-800">{formatMoneyString(o.balance)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-stone-500">
              reimburse with a cashier voucher, category “Owner reimbursement” — it nets here and lands on the ladder
            </p>
          </section>
        )}

        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Recent vouchers</h2>
          {vouchers.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">Nothing yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-rule-soft">
              {vouchers.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-stone-900">
                      {v.paid_to} · {v.category.replace(/_/g, ' ')}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {fmtDate(v.voucher_date)} · {v.paid_by === 'owner' ? `paid by ${v.owner_name} (pocket)` : 'from the drawer'}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-sm font-semibold text-stone-900">
                    {formatMoneyString(v.amount)}
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
