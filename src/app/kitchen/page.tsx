import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getClosingChecklist, getKitchenSections, listKitchenWastage } from '@/server/kitchen-queries'
import { todayIST } from '@/server/store-queries'
import ClosingChecklist from '@/components/kitchen/ClosingChecklist'
import KitchenWastageForm from '@/components/kitchen/KitchenWastageForm'
import KitchenWastageList from '@/components/kitchen/KitchenWastageList'

export const dynamic = 'force-dynamic'

export default async function KitchenPage() {
  const restaurant = await getRestaurant()
  const today = todayIST()
  const [checklist, sections, wastage] = await Promise.all([
    getClosingChecklist(restaurant.id, today),
    getKitchenSections(restaurant.id),
    listKitchenWastage(restaurant.id, 15),
  ])
  const closed = checklist.filter((c) => c.closing_value !== null).length

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Kitchen</h1>
        <p className="mt-0.5 text-sm text-stone-400">
          {restaurant.name} — {closed} of {checklist.length} sections closed today
        </p>
      </header>
      <div className="space-y-4">
        <ClosingChecklist date={today} rows={checklist} />
        <KitchenWastageForm sections={sections} />
        <KitchenWastageList rows={wastage} />
        <Link
          href="/books/recipes"
          className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 shadow-sm hover:border-emerald-400"
        >
          <span className="text-[15px] font-medium text-stone-900">Recipes — cards and live costs</span>
          <span className="text-stone-400">→</span>
        </Link>
      </div>
    </main>
  )
}
