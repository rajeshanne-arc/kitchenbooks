import { getMasters } from '@/server/queries'
import VendorNew from '@/components/books/VendorNew'

export const dynamic = 'force-dynamic'

export default async function VendorNewPage() {
  const { categories } = await getMasters()
  return (
    <section className="mt-4">
      <h2 className="mb-3 text-lg font-bold text-stone-900">Add a vendor</h2>
      <VendorNew categories={categories} />
    </section>
  )
}
