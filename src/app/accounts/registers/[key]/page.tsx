// One route, seven registers. They differ in which view they read and in
// nothing else — an accountant reads the same six columns whichever word is
// above them, so building seven pages would have been seven chances to
// drift apart.
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import {
  getRegister,
  isRegisterKey,
  REGISTER_SOURCES,
  REGISTER_TITLES,
} from '@/server/register-queries'
import { periodParamValue, readPeriodParam, resolvePeriod } from '@/lib/period'
import { fmtDate } from '@/lib/format'
import RegisterTable from '@/components/accountant/RegisterTable'
import RegisterSummary from '@/components/accountant/RegisterSummary'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { cardCls, pageSubCls, pageTitleCls } from '@/components/ui'
import { businessToday } from '@/server/business-day'
import ViewToggle from '@/components/ViewToggle'
import { readView, VIEW_KEYS } from '@/lib/views'

export const dynamic = 'force-dynamic'

// DETAIL is the register — line by line, the shape every accountant already
// reads. SUMMARY totals the same rows by party, which is the question you ask
// before you ask for the lines: who did most of this. Both come from the same
// query; nothing is re-fetched and no total is computed twice.
const VIEWS = [
  { value: 'detail' as const, label: 'Detail', hint: 'Line by line, in date order — the register itself.' },
  { value: 'summary' as const, label: 'Summary', hint: 'The same rows totalled by party, biggest first.' },
]

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>
  searchParams: Promise<{ period?: string; view?: string }>
}) {
  const { key } = await params
  if (!isRegisterKey(key)) notFound()
  const { period: periodParam, view: viewParam } = await searchParams
  const view = readView('register', viewParam)
  // ONE front door for ?period=, so preset/custom precedence is decided in
  // one place rather than in twelve hand-written ternaries.
  const periodToday = await businessToday()
  const periodReq = readPeriodParam(periodParam, periodToday)
  const period = resolvePeriod(periodReq.param, periodToday)

  const restaurant = await getRestaurant()
  const rows = await getRegister(restaurant.id, key, period.from, period.to)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>{REGISTER_TITLES[key]}</h1>
        <p className={pageSubCls}>
          {fmtDate(period.from)} — {fmtDate(period.to)} ·{' '}
          <span className="font-mono text-xs">{REGISTER_SOURCES[key]}</span>
        </p>
      </header>

      <ViewToggle
        param="view"
        value={view}
        options={VIEWS}
        defaultValue={VIEW_KEYS.register[0]}
        label="How to read this register"
      />

      <div className="pb-4">
        <PeriodControl period={period} today={periodToday} error={periodReq.error} basePath={`/accounts/registers/${key}`} />
      </div>

      <section className={cardCls}>
        {rows.length === 0 ? (
          <p className="text-sm text-stone-700">
            Nothing in this register for {fmtDate(period.from)} — {fmtDate(period.to)}. An empty
            register is a real answer; it is not the same as a register that failed to load.
          </p>
        ) : view === 'detail' ? (
          <RegisterTable rows={rows} />
        ) : (
          <RegisterSummary rows={rows} />
        )}
      </section>

      {/* THE REGISTER DOWNLOADS ITSELF. There was a separate Export screen
          listing seven links to seven CSVs; a button on the rows it exports
          is closer to the thing than a page about it. The route behind it is
          unchanged — /api/accounts/export, gated like the screen. */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-stone-400">
          Every row here is an event that was entered once and never edited.
        </p>
        {rows.length > 0 && (
          <a
            href={`/api/accounts/export?register=${key}&period=${periodParamValue(periodReq.param)}`}
            download
            className="shrink-0 rounded-lg border border-rule bg-cell px-3 py-2 text-sm font-medium text-stone-700 hover:border-emerald-400 hover:text-emerald-800"
          >
            Download CSV
          </a>
        )}
      </div>
    </>
  )
}
