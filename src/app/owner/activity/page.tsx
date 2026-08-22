import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getActivityFacets, getActivityLog } from '@/server/reports-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { periodParamValue, readPeriodParam, resolvePeriod } from '@/lib/period'
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
import { businessToday } from '@/server/business-day'
import ViewToggle from '@/components/ViewToggle'
import { readView, VIEW_KEYS } from '@/lib/views'

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

// BY TIME is the log and the default — what happened, in order, which is what
// a log is for. The other two are the questions somebody actually arrives with:
// "what did Haseeb do" and "every void this week". The FILTERS already narrow
// to one person or one type; grouping answers it without having to pick one
// first, which is the difference between interrogating a list and reading it.
const VIEWS = [
  { value: 'by-time' as const, label: 'By time', hint: 'Newest first — the log itself.' },
  { value: 'by-person' as const, label: 'By person', hint: 'Grouped by who did it, busiest first.' },
  { value: 'by-type' as const, label: 'By type', hint: 'Grouped by what was done — every void this week, in one block.' },
]

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; who?: string; what?: string; view?: string }>
}) {
  const { period: periodParam, who, what, view: viewParam } = await searchParams
  const view = readView('activity', viewParam)
  // ONE front door for ?period=, so preset/custom precedence is decided in
  // one place rather than in twelve hand-written ternaries.
  const periodToday = await businessToday()
  const periodReq = readPeriodParam(periodParam, periodToday)
  const period = resolvePeriod(periodReq.param, periodToday)
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

  // GROUPED IN THE PAGE, not re-fetched: the log is already the right rows for
  // the period and the filters, and a second query would be one filter change
  // away from grouping a different set than the list beneath it.
  const grouped: { key: string; rows: typeof rows }[] = []
  if (view !== 'by-time') {
    const by = new Map<string, typeof rows>()
    for (const r of rows) {
      const k = view === 'by-person' ? (r.entered_by ?? 'not recorded') : r.what
      by.set(k, [...(by.get(k) ?? []), r])
    }
    grouped.push(
      ...[...by.entries()]
        .map(([key, rs]) => ({ key, rows: rs }))
        .sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key)),
    )
  }

  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const pv = periodParamValue(periodReq.param)
    if (pv !== 'this-month') p.set('period', pv)
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

      <ViewToggle
        param="view"
        value={view}
        options={VIEWS}
        defaultValue={VIEW_KEYS.activity[0]}
        label="How to group the log"
      />

      <div className="space-y-3 pb-4">
        <PeriodControl period={period} today={periodToday} error={periodReq.error} basePath="/owner/activity" />

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
                {(view === 'by-time'
                  ? [{ key: null as string | null, rows }]
                  : grouped.map((g) => ({ key: g.key as string | null, rows: g.rows }))
                ).flatMap((g) => [
                  ...(g.key === null
                    ? []
                    : [
                        <tr key={`band-${g.key}`}>
                          <td colSpan={5} className="border-b border-rule bg-stone-100 px-3 py-1.5">
                            <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-600">
                              {g.key}
                            </span>
                            <span className="ml-2 text-[11px] text-stone-400">
                              {g.rows.length} {g.rows.length === 1 ? 'entry' : 'entries'}
                            </span>
                          </td>
                        </tr>,
                      ]),
                  ...g.rows.map((r) => (
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
                  )),
                ])}
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
