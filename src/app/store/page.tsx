import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getChecklist, todayIST, countOpenIndents } from '@/server/store-queries'
import { fmtDate } from '@/lib/format'
import { cardCls, codeCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'
import Honesty from '@/components/Honesty'

export const dynamic = 'force-dynamic'

// The store's own morning: what each section has taken today, and what the
// kitchen has asked for and not yet been given.
export default async function StoreHome() {
  const restaurant = await getRestaurant()
  const today = todayIST()
  const [checklist, openIndents] = await Promise.all([
    getChecklist(restaurant.id, today),
    countOpenIndents(restaurant.id),
  ])
  const entered = checklist.filter((c) => c.issues_today > 0).length

  return (
    <>
      <header>
        <h1 className={pageTitleCls}>Store</h1>
        <p className={pageSubCls}>{fmtDate(today)}</p>
      </header>

      {openIndents > 0 && (
        <div className="mt-4">
          <Honesty
            verdict="waiting"
            meter={{ filled: 0, total: openIndents, unit: 'indents issued' }}
            action={{ href: '/store/issue', label: 'Issue against an indent' }}
          >
            The kitchen has asked for stock on {openIndents} {openIndents === 1 ? 'indent' : 'indents'} that
            {openIndents === 1 ? ' has' : ' have'} not been issued yet. The issue form fills itself from the
            indent — you confirm rather than type.
          </Honesty>
        </div>
      )}

      <section className={`${cardCls} mt-4`}>
        <div className="flex items-baseline justify-between">
          <h2 className={sectionHeadCls}>Today’s issues by section</h2>
          <span className="text-xs text-stone-400">
            {entered} of {checklist.length} entered
          </span>
        </div>
        <ul className="mt-1 divide-y divide-rule-soft">
          {checklist.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                {c.issues_today > 0 ? (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <svg className="h-3.5 w-3.5 text-emerald-700" viewBox="0 0 20 20" fill="none" aria-hidden>
                      <path d="M4 10.5 8.5 15 16 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                ) : (
                  <span className="h-6 w-6 shrink-0 rounded-full border-2 border-dashed border-stone-200" aria-hidden />
                )}
                <span className="truncate text-[15px] text-stone-900">{c.name}</span>
                <span className={codeCls}>{c.code}</span>
              </span>
              {c.issues_today > 0 ? (
                <span className="shrink-0 text-xs font-medium text-emerald-700">
                  {c.issues_today} {c.issues_today === 1 ? 'issue' : 'issues'}
                </span>
              ) : (
                <Link href="/store/issue" className="shrink-0 text-xs font-medium text-stone-400 hover:text-emerald-700">
                  enter →
                </Link>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-stone-400">
          Every section that took stock today should have its issue entered before close.
        </p>
      </section>
    </>
  )
}
