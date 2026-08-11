import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getSalesDays, yesterdayIST } from '@/server/sales-queries'
import GroupTabs from '@/components/GroupTabs'
import FetchDay from '@/components/sales/FetchDay'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function CashFetchPage() {
  const restaurant = await getRestaurant()
  const days = await getSalesDays(restaurant.id)

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className={pageTitleCls}>Fetch day</h1>
        <p className={pageSubCls}>pull a day from Petpooja — the latest fetch wins</p>
      </header>
      <GroupTabs group="cashier" />

      <div className="space-y-4">
        <FetchDay defaultDate={yesterdayIST()} />

        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Recent days</h2>
            <Link href="/books/sales" className="text-xs font-medium text-emerald-700 hover:underline">
              full sales books →
            </Link>
          </div>
          {days.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">Nothing fetched yet — yesterday is the usual first pull.</p>
          ) : (
            <ul className="mt-1 divide-y divide-rule-soft">
              {days.slice(0, 10).map((d) => (
                <li key={d.business_date} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-stone-900">
                    {fmtDate(d.business_date)}
                    <span className="ml-1.5 text-xs text-stone-400">
                      {d.orders} orders · {d.covers} covers
                    </span>
                    {d.unknown_status > 0 && (
                      <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                        {d.unknown_status} unknown
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-sm font-semibold text-stone-900">{formatMoneyString(d.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
