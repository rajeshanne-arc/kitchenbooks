import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getActivityFacets, getActivityLog } from '@/server/reports-queries'
import { todayIST } from '@/server/store-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { isPeriodKey, resolvePeriod, type PeriodKey } from '@/lib/period'
import {
  cardCls,
  dataTableCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import PeriodControl from '@/components/dashboard/PeriodControl'

export const dynamic = 'force-dynamic'

// The owner's activity log.
//
// NOTHING NEW IS RECORDED HERE. entered_by and created_at have sat on every
// event table since phase 10; activity_log only reads them. This page adds
// no surveillance the app was not already doing — it makes visible what was
// always written down.
//
// Reversals are BADGED rather than hidden or merged, because a correction is
// a thing someone did, and reading it as "they changed the number" instead
// of "they filed a correction" is the difference between a ledger and an
// accusation.

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
    active
      ? 'border-emerald-700 bg-emerald-700 text-white'
      : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
  }`

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; who?: string; what?: string }>
}) {
  const { period: periodParam, who, what } = await searchParams
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : 'this-month'
  const period = resolvePeriod(periodKey, todayIST())
  const restaurant = await getRestaurant()

  const [rows, facets] = await Promise.all([
    getActivityLog(restaurant.id, {
      from: period.from,
      to: period.to,
      person: who,
      what,
    }),
    getActivityFacets(restaurant.id),
  ])

  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    if (periodKey !== 'this-month') p.set('period', periodKey)
    const merged = { who, what, ...extra }
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== '') p.set(k, v)
    const s = p.toString()
    return s === '' ? '/owner/activity' : `/owner/activity?${s}`
  }

  const reversals = rows.filter((r) => r.is_reversal).length

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Activity</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what was entered, when, and by whom
        </p>
      </header>

      <div className="space-y-3 pb-4">
        <PeriodControl active={periodKey} basePath="/owner/activity" />

        {facets.people.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-stone-500">Who</span>
            <Link href={q({ who: undefined })} className={chip(who === undefined)}>
              everyone
            </Link>
            {facets.people.map((p) => (
              <Link key={p} href={q({ who: p })} className={chip(who === p)}>
                {p}
              </Link>
            ))}
          </div>
        )}

        {facets.kinds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-stone-500">What</span>
            <Link href={q({ what: undefined })} className={chip(what === undefined)}>
              everything
            </Link>
            {facets.kinds.map((k) => (
              <Link key={k} href={q({ what: k })} className={chip(what === k)}>
                {k}
              </Link>
            ))}
          </div>
        )}
      </div>

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>
            {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
          </h2>
          <span className="font-mono text-[10px] text-stone-400">activity_log</span>
        </div>
        {reversals > 0 && (
          <p className="mt-1 text-xs text-stone-600">
            {reversals} of {rows.length} {reversals === 1 ? 'is a correction' : 'are corrections'} — a reversal
            is a thing someone filed, not a number they changed.
          </p>
        )}

        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-700">
            Nothing was entered in this period under these filters.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>What</th>
                  <th className={thCls}>On</th>
                  <th className={thCls}>Who</th>
                  <th className={thCls}>Entered</th>
                  <th className={thNumCls}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.what}-${r.id}`} className={`${trCls} ${r.is_reversal ? 'bg-stone-50' : ''}`}>
                    <td className={tdCls}>
                      {r.what}
                      {r.is_reversal && (
                        <span className="ml-1.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                          correction
                        </span>
                      )}
                    </td>
                    <td className={`${tdCls} text-stone-600`}>{fmtDate(r.on_date)}</td>
                    <td className={tdCls}>{r.entered_by ?? <span className="text-stone-400">—</span>}</td>
                    <td className={`${tdCls} text-xs text-stone-500`}>{fmtDateTime(r.created_at)}</td>
                    <td className={`${tdNumCls} ${r.is_reversal ? 'text-stone-500' : ''}`}>
                      {r.amount === null ? (
                        <span className="text-stone-400">—</span>
                      ) : (
                        formatMoneyString(r.amount)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-stone-400">
          Nothing new is recorded for this screen — every column here was already written when the entry was
          saved.
        </p>
      </section>
    </>
  )
}
