import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { listDishOptions, listMappings, listUnmapped } from '@/server/sales-queries'
import MappingTable from '@/components/sales/MappingTable'

export const dynamic = 'force-dynamic'

export default async function MappingPage() {
  const restaurant = await getRestaurant()
  const [unmapped, mapped, dishes] = await Promise.all([
    listUnmapped(restaurant.id),
    listMappings(restaurant.id),
    listDishOptions(restaurant.id),
  ])

  return (
    <div className="mt-4">
      <Link href="/sales/books/sales" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Sales
      </Link>
      <p className="mt-3 text-sm text-stone-600">
        Unmapped items are ordered by revenue — <span className="font-semibold">the top rows are half the money</span>;
        map those first and the sections page is already mostly true. Picking a dish saves immediately.
      </p>
      <MappingTable unmapped={unmapped} mapped={mapped} dishes={dishes} />
    </div>
  )
}
