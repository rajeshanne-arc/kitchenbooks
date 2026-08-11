import { getMasters } from '@/server/queries'
import ItemNew from '@/components/books/ItemNew'

export const dynamic = 'force-dynamic'

export default async function ItemNewPage() {
  const { categories, units } = await getMasters()
  return (
    <section className="mt-4">
      <h2 className="mb-3 text-lg font-bold text-stone-900">Add an item</h2>
      <ItemNew categories={categories} units={units} />
    </section>
  )
}
