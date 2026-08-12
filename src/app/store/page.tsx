import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import {
  countItemsWithReorderLevel,
  countReorderDue,
  getIssuesBySection,
  getPaymentsTotal,
  getPurchaseSeries,
  getPurchasesByVendor,
  getSectionConsumptionDaily,
  listOpenIndents,
  todayIST,
} from '@/server/store-queries'
import { getStockAlarms } from '@/server/dashboard-queries'
import { listVendorsWithDues } from '@/server/books-queries'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { isPeriodKey, resolvePeriod, type PeriodKey } from '@/lib/period'
import {
  cardCls,
  dataTableCls,
  heroNumCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import Honesty from '@/components/Honesty'
import MyQueriesPanel from '@/components/accountant/MyQueriesPanel'
import ConsumptionByDept from '@/components/dashboard/ConsumptionByDept'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { MagnitudeBars, SalesLine } from '@/components/dashboard/Charts'

export const dynamic = 'force-dynamic'

// The store's own dashboard. Not the owner's questions rephrased — the
// store manager's: what came in, where it went, who is owed, what to buy,
// and what is impossible. Same period control and the same chart rules.

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

export default async function StoreHome({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : 'this-month'
  const today = todayIST()
  const period = resolvePeriod(periodKey, today)

  const restaurant = await getRestaurant()
  const [
    openIndents,
    purchases,
    issuesBySection,
    paymentsTotal,
    byVendor,
    dues,
    alarms,
    reorderCount,
    itemsWithLevel,
    consumption,
  ] = await Promise.all([
    listOpenIndents(restaurant.id),
    getPurchaseSeries(restaurant.id, period.from, period.to),
    getIssuesBySection(restaurant.id, period.from, period.to),
    getPaymentsTotal(restaurant.id, period.from, period.to),
    getPurchasesByVendor(restaurant.id, period.from, period.to),
    listVendorsWithDues(restaurant.id),
    getStockAlarms(restaurant.id),
    countReorderDue(restaurant.id),
    countItemsWithReorderLevel(restaurant.id),
    getSectionConsumptionDaily(restaurant.id, period.from, period.to),
  ])

  const purchaseTotal = purchases.reduce((n, p) => n + decimalStringToPaise(p.total), 0)
  const issueTotal = issuesBySection.reduce((n, s) => n + decimalStringToPaise(s.value), 0)
  const duesTotal = dues.reduce((n, d) => n + decimalStringToPaise(d.balance), 0)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Store</h1>
        <p className={pageSubCls}>
          {period.label} · {fmtDate(period.from)} — {fmtDate(period.to)}
        </p>
      </header>

      {/* What the accountant is asking THIS role, on the screen they already
          open every morning. Renders nothing when nothing is asked. */}
      <div className="pb-4">
        <MyQueriesPanel />
      </div>

      <div className="pb-4">
        <ConsumptionByDept
          rows={consumption}
          title="Issued out, by department"
          caption={`${fmtDate(period.from)} — ${fmtDate(period.to)}, net of anything sent back`}
        />
      </div>

      <div className="pb-4">
        <PeriodControl active={periodKey} basePath="/store" />
      </div>

      {/* what needs doing right now, above everything measured */}
      {(openIndents.length > 0 || alarms.length > 0 || reorderCount > 0) && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {alarms.length > 0 && (
            <Link
              href="/store/books/stock"
              className={`${cardCls} block border-red-300 bg-red-50/50 hover:border-red-400`}
            >
              <h2 className={`${sectionHeadCls} text-red-700`}>Negative stock</h2>
              <p className={`mt-1 text-[26px] ${heroNumCls} text-red-700`}>{alarms.length}</p>
              <p className="text-xs text-red-800">
                issued more than ever bought — a bill is missing
              </p>
            </Link>
          )}
          {reorderCount > 0 && (
            <Link href="/store/reorder" className={`${cardCls} block border-amber-300 bg-amber-50/40`}>
              <h2 className={sectionHeadCls}>To reorder</h2>
              <p className={`mt-1 text-[26px] ${heroNumCls} text-amber-900`}>{reorderCount}</p>
              <p className="text-xs text-amber-900">at or below their reorder level</p>
            </Link>
          )}
          {openIndents.length > 0 && (
            <Link href="/store/issue" className={`${cardCls} block border-amber-300 bg-amber-50/40`}>
              <h2 className={sectionHeadCls}>Open indents</h2>
              <p className={`mt-1 text-[26px] ${heroNumCls} text-amber-900`}>{openIndents.length}</p>
              <p className="text-xs text-amber-900">kitchens waiting to be issued</p>
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {/* goods in */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Goods in</h2>
            <span className="font-mono text-[10px] text-stone-400">purchases</span>
          </div>
          <p className="mt-1.5 text-sm text-stone-700">
            {purchases.length === 0
              ? 'No bills entered for this period.'
              : `${formatPaise(purchaseTotal)} across ${purchases.length} ${plural(purchases.length, 'day')}.`}
          </p>
          {purchases.length === 1 ? (
            <p className={`mt-1 text-[26px] ${heroNumCls} text-stone-900`}>
              {formatMoneyString(purchases[0].total)}
            </p>
          ) : (
            purchases.length > 1 && (
              <div className="mt-2">
                <SalesLine points={purchases.map((p) => ({ date: p.date, revenue: p.total, orders: 0 }))} />
              </div>
            )
          )}
        </section>

        {/* stock out, by section */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Stock out, by section</h2>
            <span className="font-mono text-[10px] text-stone-400">issue_lines</span>
          </div>
          <p className="mt-1.5 text-sm text-stone-700">
            {issuesBySection.length === 0
              ? 'Nothing issued in this period.'
              : `${formatPaise(issueTotal)} left the store for ${issuesBySection.length} ${plural(
                  issuesBySection.length,
                  'section',
                )}.`}
          </p>
          {issuesBySection.length > 0 && (
            <div className="mt-2">
              <MagnitudeBars
                rows={issuesBySection.slice(0, 6).map((s) => ({ label: s.section, value: Number(s.value) }))}
                height={Math.max(110, Math.min(issuesBySection.length, 6) * 28 + 40)}
              />
            </div>
          )}
        </section>

        {/* vendor dues */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Outstanding to vendors</h2>
            <span className="font-mono text-[10px] text-stone-400">vendor_dues</span>
          </div>
          <p className="mt-1.5 text-sm text-stone-700">
            {dues.length === 0
              ? 'Nothing outstanding to any vendor.'
              : `${formatPaise(duesTotal)} owed across ${dues.length} ${plural(dues.length, 'vendor')}.`}
          </p>
          {dues.length > 0 && (
            <>
              <div className="mt-2">
                <MagnitudeBars
                  rows={dues.slice(0, 6).map((d) => ({ label: d.name, value: Number(d.balance) }))}
                  height={Math.max(110, Math.min(dues.length, 6) * 28 + 40)}
                />
              </div>
              <Link
                href="/store/receive/pay"
                className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline"
              >
                pay a vendor →
              </Link>
            </>
          )}
        </section>

        {/* payments out */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Paid out</h2>
            <span className="font-mono text-[10px] text-stone-400">payments</span>
          </div>
          <p className="mt-1.5 text-sm text-stone-700">
            {paymentsTotal.count === 0
              ? 'No vendor payments recorded in this period.'
              : `${formatMoneyString(paymentsTotal.total)} in ${paymentsTotal.count} ${plural(
                  paymentsTotal.count,
                  'payment',
                )}.`}
          </p>
          {paymentsTotal.count > 0 && (
            <p className={`mt-1 text-[26px] ${heroNumCls} text-stone-900`}>
              {formatMoneyString(paymentsTotal.total)}
            </p>
          )}
          {byVendor.length > 0 && (
            <div className="mt-3 overflow-x-auto border-t border-rule-soft pt-2">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Bought from</th>
                    <th className={thNumCls}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {byVendor.map((v) => (
                    <tr key={v.vendor} className={trCls}>
                      <td className={tdCls}>{v.vendor}</td>
                      <td className={tdNumCls}>{formatMoneyString(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* reorder honesty — an empty list is not a full store */}
      {reorderCount === 0 && itemsWithLevel === 0 && (
        <section className={`${cardCls} mt-3`}>
          <h2 className={sectionHeadCls}>Reorder is not set up</h2>
          <div className="mt-2">
            <Honesty verdict="not set up" compact>
              No item carries a reorder level, so nothing can ever appear on the Reorder tab. That list is empty
              because the question has not been asked — not because the store is full. Set levels under Masters →
              Items.
            </Honesty>
          </div>
        </section>
      )}

      {/* WHAT IS ACTUALLY OUTSTANDING — open indents nobody has filled.
          This replaced a per-department checklist that could never be
          honestly completed: a zero beside Bakery could not tell "took
          nothing today" from "nobody wrote it down", so the only way to
          finish it was to issue stock to a department that did not want
          any. A list that cannot be completed is a list people stop
          reading. An open indent is a real request, from a real person,
          that is finite and can actually be cleared. */}
      <section className={`${cardCls} mt-3`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Requests waiting to be filled</h2>
          <span className="text-xs text-stone-400">open_indents</span>
        </div>
        {openIndents.length === 0 ? (
          <p className="mt-1.5 text-sm text-stone-700">
            Nothing is waiting. The kitchens have asked for nothing the store has not already given.
          </p>
        ) : (
          <>
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Department</th>
                    <th className={thCls}>Session</th>
                    <th className={thCls}>Asked</th>
                    <th className={thNumCls}>Items</th>
                    <th className={thCls}>
                      <span className="sr-only">Fill</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {openIndents.map((i) => (
                    <tr key={i.id} className={trCls}>
                      <td className={tdCls}>{i.section_name}</td>
                      <td className={`${tdCls} text-stone-600`}>{i.session}</td>
                      <td className={`${tdCls} text-stone-500`}>
                        {fmtDate(i.indent_date)}
                        {i.entered_by !== null && ` · ${i.entered_by}`}
                      </td>
                      <td className={tdNumCls}>{i.line_count}</td>
                      <td className={`${tdCls} text-right`}>
                        <Link
                          href={`/store/issue?indent=${i.id}`}
                          className="text-xs font-medium text-emerald-700 hover:underline"
                        >
                          fill it →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-stone-400">
              Each one is a request a kitchen made and is waiting on. Filling it stamps the issue
              against the indent, which is what makes the asked-versus-given gap mean anything.
            </p>
          </>
        )}
      </section>
    </>
  )
}
