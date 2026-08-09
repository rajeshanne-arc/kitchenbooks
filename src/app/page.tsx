import BillEntry from '@/components/BillEntry'
import { getMasters, getRestaurant } from '@/server/queries'

export const dynamic = 'force-dynamic'

export default async function Home() {
  let restaurantName: string
  let categories, units
  try {
    const [restaurant, masters] = await Promise.all([getRestaurant(), getMasters()])
    restaurantName = restaurant.name
    categories = masters.categories
    units = masters.units
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

  return (
    <main className="pb-36">
      <header className="mx-auto max-w-2xl px-4 pb-5 pt-8 sm:px-6">
        <p className="text-[13px] font-semibold tracking-tight text-emerald-700">
          KitchenBooks <span className="font-normal text-stone-400">· {restaurantName}</span>
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-stone-900">New purchase bill</h1>
      </header>
      <BillEntry categories={categories} units={units} />
    </main>
  )
}
