import { getMasters, getRestaurant } from '@/server/queries'
import { listActiveVendors } from '@/server/books-queries'
import ItemNew from '@/components/books/ItemNew'

export const dynamic = 'force-dynamic'

export default async function ItemNewPage() {
  const restaurant = await getRestaurant()
  const [{ categories, units }, vendors] = await Promise.all([
    getMasters(),
    listActiveVendors(restaurant.id),
  ])
  return (
    <section className="mt-4">
      <h2 className="mb-3 text-lg font-bold text-stone-900">Add an item</h2>
      <ItemNew categories={categories} units={units} vendors={vendors} />
    </section>
  )
}
