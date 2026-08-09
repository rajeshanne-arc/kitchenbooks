import IssueEntry from '@/components/store/IssueEntry'
import { getRestaurant } from '@/server/queries'
import { getSections } from '@/server/store-queries'

export const dynamic = 'force-dynamic'

export default async function IssuePage() {
  const restaurant = await getRestaurant()
  const sections = await getSections(restaurant.id)
  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Issue to section</h1>
        <p className="mt-0.5 text-sm text-stone-400">{restaurant.name} store</p>
      </header>
      <IssueEntry sections={sections} />
    </main>
  )
}
