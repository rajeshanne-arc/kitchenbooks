import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { listVendorPerformance } from '@/server/shorts-queries'
import { formatMoneyString } from '@/lib/money'
import Honesty from '@/components/Honesty'
import {
  cardCls,
  dataTableCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

// vendor_performance, rendered verbatim. THE VIEW OWNS EVERY FIGURE — bills,
// short events, short value, unsettled and returned value are all counted in
// Postgres over the same joins, so this page and the shorts list can never
// disagree. The only decision made here is the ORDER, and it puts what is
// still owed on top.
//
// A vendor with no shorts is a good vendor, not a missing row: the zeroes are
// rendered quietly rather than dropped, because "delivered everything they
// billed, twenty-two times" is the finding most worth having.

export default async function VendorPerformancePage() {
  const restaurant = await getRestaurant()
  const rows = await listVendorPerformance(restaurant.id)

  const withShorts = rows.filter((r) => r.short_events > 0)
  const unsettled = rows.filter((r) => r.unsettled > 0)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Vendor performance</h1>
        <p className={pageSubCls}>{restaurant.name} — how each vendor delivers, all time</p>
      </header>

      {rows.length === 0 ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>No vendors yet</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            Vendors are born on the first bill you enter for them — there is nothing to measure until then.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {withShorts.length === 0 && (
            <Honesty verdict="unasked" action={{ href: '/store/books/shorts', label: 'Shorts and damages' }}>
              No short has ever been recorded against any vendor. That can mean every delivery arrived complete, or
              that nobody has been recording the ones that did not — this table cannot tell you which, and it will
              read the same either way.
            </Honesty>
          )}

          {unsettled.length > 0 && (
            <Honesty
              level="alarm"
              verdict="unchased"
              action={{ href: '/store/books/shorts', label: 'Chase them' }}
            >
              {unsettled.length} {unsettled.length === 1 ? 'vendor has' : 'vendors have'} shorts nobody has settled.
              Until somebody asks, the money stays theirs.
            </Honesty>
          )}

          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={sectionHeadCls}>Every vendor, worst first</h2>
              <span className="font-mono text-[10px] text-stone-400">vendor_performance</span>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Vendor</th>
                    <th className={thCls}>Code</th>
                    <th className={thNumCls}>Bills</th>
                    <th className={thNumCls}>Short events</th>
                    <th className={thNumCls}>Short value</th>
                    <th className={thNumCls}>Unsettled</th>
                    <th className={thNumCls}>Returned</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const clean = r.short_events === 0
                    return (
                      <tr key={r.vendor_id} className={trCls}>
                        <td className={tdCls}>
                          <Link href={`/store/masters/vendors/${r.vendor_id}`} className="hover:underline">
                            {r.name}
                          </Link>
                        </td>
                        <td className={tdCodeCls}>{r.code}</td>
                        <td className={`${tdNumCls} text-stone-500`}>{r.bills}</td>
                        <td className={`${tdNumCls} ${clean ? 'text-stone-300' : 'text-stone-900'}`}>
                          {r.short_events}
                        </td>
                        <td className={`${tdNumCls} ${clean ? 'text-stone-300' : 'font-semibold text-stone-900'}`}>
                          {formatMoneyString(r.short_value)}
                        </td>
                        <td className={`${tdNumCls} ${r.unsettled > 0 ? 'font-semibold text-red-700' : 'text-stone-300'}`}>
                          {r.unsettled}
                        </td>
                        <td className={`${tdNumCls} text-stone-500`}>{formatMoneyString(r.returned_value)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-[13px] text-stone-500">
            A vendor with nothing in the short columns has delivered what they billed, as far as this book knows —
            that is a finding, not an empty row. <b>Short value</b> is the shortfall priced at the rate on the bill;{' '}
            <b>unsettled</b> counts the ones still open, which is the only part still worth chasing.{' '}
            <b>Returned</b> is goods sent back to the vendor, a separate event from a short.
          </p>
        </div>
      )}
    </>
  )
}
