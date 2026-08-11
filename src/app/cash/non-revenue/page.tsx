import { getRestaurant } from '@/server/queries'
import { getGiveawayMonth, listGiveawayDishes, listNonRevenue } from '@/server/cashier-queries'
import { getList, getNameHistory } from '@/server/settings'
import { monthStartIST } from '@/server/store-queries'
import GroupTabs from '@/components/GroupTabs'
import NonRevenueClient from '@/components/cash/NonRevenueClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function NonRevenuePage() {
  const restaurant = await getRestaurant()
  const [reasons, dishes, rows, giveaway, givenToNames] = await Promise.all([
    getList(restaurant.id, 'non_revenue_reason'),
    listGiveawayDishes(restaurant.id),
    listNonRevenue(restaurant.id, 20),
    getGiveawayMonth(restaurant.id, monthStartIST()),
    getNameHistory(restaurant.id, 'non_revenue_given_to'),
  ])

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className={pageTitleCls}>Non-revenue</h1>
        <p className={pageSubCls}>staff meals, owner tables, PR plates — giveaways cost something</p>
      </header>
      <GroupTabs group="cashier" />
      <NonRevenueClient reasons={reasons} dishes={dishes} rows={rows} giveaway={giveaway} givenToNames={givenToNames} />
    </main>
  )
}
