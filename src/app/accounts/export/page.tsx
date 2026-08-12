// Export. Generic tabular first, because every accounting package on earth
// takes a CSV and none of them agree on anything more specific.
//
// Package-specific mappings — Tally, Zoho, QuickBooks — are CONFIGURATION
// for later, never a hardcoded assumption about which software this
// particular customer bought.
import { getRestaurant } from '@/server/queries'
import { REGISTER_KEYS, REGISTER_SOURCES, REGISTER_TITLES } from '@/server/register-queries'
import { todayIST } from '@/server/store-queries'
import { isPeriodKey, resolvePeriod, type PeriodKey } from '@/lib/period'
import { fmtDate } from '@/lib/format'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : 'this-month'
  const period = resolvePeriod(periodKey, todayIST())
  const restaurant = await getRestaurant()

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Export</h1>
        <p className={pageSubCls}>
          {restaurant.name} — {fmtDate(period.from)} to {fmtDate(period.to)}
        </p>
      </header>

      <div className="pb-4">
        <PeriodControl active={periodKey} basePath="/accounts/export" />
      </div>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Registers as CSV</h2>
        <p className="mt-1.5 text-sm text-stone-700">
          Plain comma-separated rows with the numbers unformatted, because the file is going into
          someone else&apos;s software and ₹1,04,500.00 is a string to every one of them.
        </p>
        <ul className="mt-3 divide-y divide-rule-soft">
          {REGISTER_KEYS.map((k) => (
            <li key={k} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm text-stone-900">{REGISTER_TITLES[k]}</span>
                <span className="block font-mono text-[11px] text-stone-400">{REGISTER_SOURCES[k]}</span>
              </span>
              <a
                href={`/api/accounts/export?register=${k}&period=${periodKey}`}
                download
                className="shrink-0 rounded-lg border border-rule bg-cell px-3 py-2 text-sm font-medium text-stone-700 hover:border-emerald-400 hover:text-emerald-800"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-3 text-center text-xs text-stone-400">
        Tally, Zoho and QuickBooks layouts arrive as configuration — a mapping this restaurant
        chooses, not one the app assumes.
      </p>
    </>
  )
}
