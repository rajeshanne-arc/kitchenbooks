import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getChecklist, todayIST } from '@/server/store-queries'
import { fmtDate } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const tileCls =
  'rounded-2xl border p-4 text-[15px] font-semibold shadow-sm transition-colors'

export default async function Home() {
  let restaurantName: string
  let checklist
  const today = todayIST()
  try {
    const restaurant = await getRestaurant()
    restaurantName = restaurant.name
    checklist = await getChecklist(restaurant.id, today)
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

  const entered = checklist.filter((c) => c.issues_today > 0).length

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Today at {restaurantName}</h1>
        <p className="mt-0.5 text-sm text-stone-400">{fmtDate(today)}</p>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Link href="/issue" className={`${tileCls} border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800`}>
          Issue to section
          <span className="mt-0.5 block text-xs font-normal text-emerald-100">stock going to a kitchen</span>
        </Link>
        <Link href="/wastage" className={`${tileCls} border-stone-200 bg-white text-stone-900 hover:border-amber-400`}>
          Record wastage
          <span className="mt-0.5 block text-xs font-normal text-stone-400">spoilage, prep errors…</span>
        </Link>
        <Link
          href="/attendance"
          className={`${tileCls} border-stone-200 bg-white text-stone-900 hover:border-emerald-400`}
        >
          Attendance
          <span className="mt-0.5 block text-xs font-normal text-stone-400">who’s in today</span>
        </Link>
        <Link href="/bill" className={`${tileCls} border-stone-200 bg-white text-stone-900 hover:border-emerald-400`}>
          New purchase bill
          <span className="mt-0.5 block text-xs font-normal text-stone-400">goods coming in</span>
        </Link>
        <Link
          href="/books/stock"
          className={`${tileCls} border-stone-200 bg-white text-stone-900 hover:border-emerald-400`}
        >
          Stock on hand
          <span className="mt-0.5 block text-xs font-normal text-stone-400">what’s in the store</span>
        </Link>
      </div>

      <section className={`${cardCls} mt-4`}>
        <div className="flex items-baseline justify-between">
          <h2 className={sectionHeadCls}>Today’s issues by section</h2>
          <span className="text-xs text-stone-400">
            {entered} of {checklist.length} entered
          </span>
        </div>
        <ul className="mt-1 divide-y divide-stone-100">
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
                <span className="font-mono text-[11px] text-stone-400">{c.code}</span>
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
    </main>
  )
}
