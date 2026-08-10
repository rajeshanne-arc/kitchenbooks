import { getRestaurant } from '@/server/queries'
import { getDuesOutstanding, listDues } from '@/server/cashier-queries'
import { getNameHistory } from '@/server/settings'
import GroupTabs from '@/components/GroupTabs'
import DuesClient from '@/components/cash/DuesClient'

export const dynamic = 'force-dynamic'

export default async function DuesPage() {
  const restaurant = await getRestaurant()
  const [parties, rows, outstanding] = await Promise.all([
    getNameHistory(restaurant.id, 'due_party'),
    listDues(restaurant.id, 20),
    getDuesOutstanding(restaurant.id),
  ])

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Dues</h1>
        <p className="mt-0.5 text-sm text-stone-400">credit out, repayments in — one ledger per party</p>
      </header>
      <GroupTabs group="cashier" />
      <DuesClient parties={parties} rows={rows} outstanding={outstanding} />
    </main>
  )
}
