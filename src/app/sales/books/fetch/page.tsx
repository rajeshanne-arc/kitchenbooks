import WhyNoRange from '@/components/books/WhyNoRange'
import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getSalesDays, listPosSyncRuns } from '@/server/sales-queries'
import FetchDay from '@/components/sales/FetchDay'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'
import { businessToday, businessYesterday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

export default async function CashFetchPage() {
  const restaurant = await getRestaurant()
  const [days, syncRuns] = await Promise.all([getSalesDays(restaurant.id), listPosSyncRuns(restaurant.id)])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Fetch day</h1>
        <p className={pageSubCls}>pull a day from Petpooja — the latest fetch wins</p>
      </header>

      {/* THE THIRD VERDICT, and the only screen in Books carrying it. Not flow
          and not state: the data IS dated and SOMEBODY ELSE decides the grain.
          Petpooja's Get Orders is keyed to ONE business date, so a range here
          would offer to widen what the API cannot. The limit is not ours, and
          the lead says "one day at a time" rather than "no date range" because
          there is a date input three inches below — the reader's question is
          not where the picker went, it is why a week cannot be asked for. */}
      <WhyNoRange
        why="source"
        what="Petpooja's Get Orders answers for a single business date, so there is no range to ask for — the day is picked below."
      />

      <div className="space-y-4">
        <FetchDay defaultDate={await businessYesterday()} today={await businessToday()} />

        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Recent days</h2>
            <Link href="/sales/books/sales" className="text-xs font-medium text-emerald-700 hover:underline">
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

        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Sync attempts</h2>
            <span className="font-mono text-[11px] text-stone-400">pos_sync_runs</span>
          </div>
          <p className="mt-1 text-sm text-stone-600">Every manual or scheduled attempt stays visible, including failures. A failed attempt is not a sales fetch.</p>
          {syncRuns.length === 0 ? <p className="mt-2 text-sm text-stone-500">No sync has been attempted yet.</p> : (
            <ul className="mt-2 divide-y divide-rule-soft">
              {syncRuns.map((run) => (
                <li key={run.id} className="flex flex-wrap items-baseline gap-x-2 py-2 text-sm">
                  <span className="font-medium text-stone-900">{fmtDate(run.business_date)}</span>
                  <span className={run.status === 'failed' ? 'text-red-700' : run.status === 'succeeded' ? 'text-emerald-700' : 'text-amber-700'}>{run.status}</span>
                  <span className="text-xs text-stone-500">attempt {run.attempt}</span>
                  {run.error !== null && <span className="basis-full text-xs text-red-700">{run.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
