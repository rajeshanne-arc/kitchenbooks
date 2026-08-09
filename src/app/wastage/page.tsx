import WastageEntry from '@/components/store/WastageEntry'
import { getRestaurant } from '@/server/queries'

export const dynamic = 'force-dynamic'

export default async function WastagePage() {
  const restaurant = await getRestaurant()
  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Record wastage</h1>
        <p className="mt-0.5 text-sm text-stone-400">{restaurant.name} store</p>
      </header>
      <WastageEntry />
    </main>
  )
}
