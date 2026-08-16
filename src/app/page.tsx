import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { groupsFor, homeFor } from '@/lib/roles'
import { fmtDate } from '@/lib/format'
import { pageSubCls, pageTitleCls } from '@/components/ui'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

// The front door. A role with exactly one group never sees a chooser — it
// lands in its own group and stays there. Managers and owners get the tiles,
// matrix-filtered like every other surface.
export default async function Home() {
  const user = await getSessionUser()
  if (user === null) redirect('/login')

  const only = homeFor(user.role)
  if (only !== null) redirect(only)

  let restaurantName = 'KitchenBooks'
  try {
    restaurantName = (await getRestaurant()).name
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

  const groups = groupsFor(user.role)
  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-6 sm:px-6">
      <header>
        <h1 className={pageTitleCls}>Today at {restaurantName}</h1>
        <p className={pageSubCls}>{fmtDate(await businessToday())}</p>
      </header>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {groups.map((g, i) => (
          <Link
            key={g.key}
            href={g.href}
            className={`rounded-2xl border p-4 transition-colors ${
              i === 0
                ? 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800'
                : 'border-rule bg-cell text-stone-900 hover:border-emerald-400'
            }`}
          >
            <span className="text-[15px] font-semibold">{g.label}</span>
            <span className={`mt-0.5 block text-xs ${i === 0 ? 'text-emerald-100' : 'text-stone-500'}`}>
              {g.blurb}
            </span>
          </Link>
        ))}
      </div>
    </main>
  )
}
