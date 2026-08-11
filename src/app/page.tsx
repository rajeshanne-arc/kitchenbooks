import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getChecklist, todayIST, countOpenIndents } from '@/server/store-queries'
import { getSessionUser } from '@/server/current-user'
import { canAccess, type Role } from '@/lib/roles'
import { fmtDate } from '@/lib/format'
import { cardCls, codeCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const tileCls =
  'rounded-2xl border p-4 text-[15px] font-semibold shadow-sm transition-colors'

// One tile per frequent job. STRICT INVISIBILITY: the matrix filters this
// list per role — a tile that would land on “permission denied” is never
// painted.
const TILES: { href: string; title: string; sub: string }[] = [
  { href: '/issue', title: 'Issue to section', sub: 'stock going to a kitchen' },
  { href: '/wastage', title: 'Record wastage', sub: 'spoilage, prep errors…' },
  { href: '/bill', title: 'New purchase bill', sub: 'goods coming in' },
  { href: '/kitchen/indent', title: 'Indent the store', sub: 'ask for tomorrow’s stock' },
  { href: '/kitchen/closing', title: 'Kitchen closing', sub: 'what each section still holds' },
  { href: '/cash', title: 'Close the day', sub: 'the cashier’s ladder' },
  { href: '/attendance', title: 'Attendance', sub: 'who’s in today' },
  { href: '/books/stock', title: 'Stock on hand', sub: 'what’s in the store' },
  { href: '/dashboard', title: 'Owner dashboard', sub: 'the ten questions' },
  { href: '/settings', title: 'Settings', sub: 'lists · tabs · language' },
]

export default async function Home() {
  let restaurantName: string
  let checklist
  let role: Role | null = null
  let openIndents = 0
  const today = todayIST()
  try {
    const [restaurant, user] = await Promise.all([getRestaurant(), getSessionUser()])
    restaurantName = restaurant.name
    role = user?.role ?? null
    const wantsChecklist = role !== null && canAccess(role, '/issue')
    ;[checklist, openIndents] = await Promise.all([
      wantsChecklist ? getChecklist(restaurant.id, today) : Promise.resolve([]),
      wantsChecklist ? countOpenIndents(restaurant.id) : Promise.resolve(0),
    ])
  } catch (e) {
    console.error('bootstrap failed', e)
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-xl font-semibold text-stone-900">KitchenBooks isn’t connected yet</h1>
        <p className="mt-2 text-sm text-stone-600">
          The database could not be reached, or the restaurant row is missing. Check{' '}
          <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">DATABASE_URL</code> and reload.
        </p>
      </main>
    )
  }

  const tiles = role === null ? [] : TILES.filter((t) => canAccess(role as Role, t.href))
  const showChecklist = role !== null && canAccess(role, '/issue')
  const entered = checklist.filter((c) => c.issues_today > 0).length

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header>
        <h1 className={pageTitleCls}>Today at {restaurantName}</h1>
        <p className={pageSubCls}>{fmtDate(today)}</p>
      </header>

      {showChecklist && openIndents > 0 && (
        <Link
          href="/issue"
          className="mt-4 flex items-center justify-between rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm hover:border-amber-400"
        >
          <span className="text-[15px] font-semibold text-amber-900">
            {openIndents} open {openIndents === 1 ? 'indent' : 'indents'} waiting for issue
          </span>
          <span className="text-amber-700">→</span>
        </Link>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        {tiles.map((t, i) => (
          <Link
            key={t.href}
            href={t.href}
            className={`${tileCls} ${
              i === 0
                ? 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800'
                : 'border-stone-200 bg-white text-stone-900 hover:border-emerald-400'
            }`}
          >
            {t.title}
            <span className={`mt-0.5 block text-xs font-normal ${i === 0 ? 'text-emerald-100' : 'text-stone-400'}`}>
              {t.sub}
            </span>
          </Link>
        ))}
      </div>

      {showChecklist && (
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
                  <Link href="/issue" className="shrink-0 text-xs font-medium text-stone-400 hover:text-emerald-700">
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
      )}
    </main>
  )
}
