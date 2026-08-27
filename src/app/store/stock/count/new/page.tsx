import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import {
  getCountProgress,
  getIssueHistoryDays,
  getOpenCount,
  listCountableItems,
} from '@/server/counts-queries'
import { businessToday } from '@/server/business-day'
import CountEntry from '@/components/counts/CountEntry'

export const dynamic = 'force-dynamic'

export default async function NewCountPage() {
  const restaurant = await getRestaurant()
  const today = await businessToday()
  const [items, historyDays, openCount] = await Promise.all([
    listCountableItems(restaurant.id),
    getIssueHistoryDays(restaurant.id),
    // SOMEBODY ELSE MAY ALREADY BE COUNTING. Two people counting two rooms are
    // doing one count; the sheet offers to join rather than silently starting
    // a second book for the same night.
    getOpenCount(restaurant.id, today),
  ])
  const progress = openCount === null ? [] : await getCountProgress(restaurant.id, openCount.id)

  return (
    <div className="mt-4">
      <Link href="/store/stock/count" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Counts
      </Link>
      {items.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
          <p className="text-[15px] font-semibold text-stone-900">Nothing to count yet.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">Items are born on purchase bills — enter the bill first.</p>
        </div>
      ) : (
        <div className="mt-3">
          <CountEntry
            items={items}
            historyDays={historyDays}
            openCount={openCount}
            progress={progress}
          />
        </div>
      )}
    </div>
  )
}
