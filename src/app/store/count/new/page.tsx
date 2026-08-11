import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getIssueHistoryDays, listCountableItems } from '@/server/counts-queries'
import CountEntry from '@/components/counts/CountEntry'

export const dynamic = 'force-dynamic'

export default async function NewCountPage() {
  const restaurant = await getRestaurant()
  const [items, historyDays] = await Promise.all([
    listCountableItems(restaurant.id),
    getIssueHistoryDays(restaurant.id),
  ])

  return (
    <div className="mt-4">
      <Link href="/store/count" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Counts
      </Link>
      {items.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
          <p className="text-[15px] font-semibold text-stone-900">Nothing to count yet.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">Items are born on purchase bills — enter the bill first.</p>
        </div>
      ) : (
        <div className="mt-3">
          <CountEntry items={items} historyDays={historyDays} />
        </div>
      )}
    </div>
  )
}
