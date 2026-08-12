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
import { todayIST } from '@/server/store-queries'
import { isPeriodKey, resolvePeriod, type PeriodKey } from '@/lib/period'
import { fmtDate } from '@/lib/format'
import RegisterTable from '@/components/accountant/RegisterTable'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { cardCls, pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>
  searchParams: Promise<{ period?: string }>
}) {
  const { key } = await params
  if (!isRegisterKey(key)) notFound()
  const { period: periodParam } = await searchParams
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : 'this-month'
  const period = resolvePeriod(periodKey, todayIST())

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

      <div className="pb-4">
        <PeriodControl active={periodKey} basePath={`/accounts/registers/${key}`} />
      </div>

      <section className={cardCls}>
        {rows.length === 0 ? (
          <p className="text-sm text-stone-700">
            Nothing in this register for {fmtDate(period.from)} — {fmtDate(period.to)}. An empty
            register is a real answer; it is not the same as a register that failed to load.
          </p>
        ) : (
          <RegisterTable rows={rows} />
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
            href={`/api/accounts/export?register=${key}&period=${periodKey}`}
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
