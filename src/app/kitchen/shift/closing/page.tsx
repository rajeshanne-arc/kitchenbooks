import { getRestaurant } from '@/server/queries'
import { getClosingChecklist, getKitchenSections, getTodaysProductions } from '@/server/kitchen-queries'
import { todayIST } from '@/server/store-queries'
import ClosingEntry from '@/components/kitchen/ClosingEntry'
import { formatMoneyString } from '@/lib/money'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function ClosingPage() {
  const restaurant = await getRestaurant()
  const today = todayIST()
  const [sections, checklist] = await Promise.all([
    getKitchenSections(restaurant.id),
    getClosingChecklist(restaurant.id, today),
  ])
  const todaysProductions = (
    await Promise.all(sections.map((s) => getTodaysProductions(restaurant.id, s.id, today)))
  ).flat()
  const closed = checklist.filter((c) => c.closing_value !== null).length

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Closing</h1>
        <p className={pageSubCls}>
          {closed} of {checklist.length} sections closed today
        </p>
      </header>

      <div className="space-y-4">
        <ClosingEntry sections={sections} todaysProductions={todaysProductions} />

        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Tonight so far</h2>
          <ul className="mt-1 divide-y divide-rule-soft">
            {checklist.map((r) => (
              <li key={r.section_id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-[11px] text-stone-400">{r.code}</span>
                  <span className="truncate text-sm text-stone-900">{r.name}</span>
                </span>
                {r.closing_value !== null ? (
                  <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                    {formatMoneyString(r.closing_value)}
                    {r.filings > 1 && ` · corrected ×${r.filings - 1}`}
                  </span>
                ) : (
                  <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[11px] text-stone-400">
                    not closed
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-400">Zero is a real closing — an empty section is information.</p>
        </section>
      </div>
    </>
  )
}
