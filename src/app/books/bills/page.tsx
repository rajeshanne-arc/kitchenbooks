import Link from 'next/link'
import BillList from '@/components/books/BillList'
import { getRestaurant } from '@/server/queries'
import { listBills } from '@/server/books-queries'

export const dynamic = 'force-dynamic'

export default async function BillsPage() {
  const restaurant = await getRestaurant()
  const bills = await listBills(restaurant.id)

  if (bills.length === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center">
        <p className="text-lg font-semibold text-stone-900">The books are empty — for now.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
          Save your first purchase bill and it lands here, with its vendor and items created along the way. No setup
          needed.
        </p>
        <Link
          href="/bill"
          className="mt-5 inline-block rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Enter your first bill
        </Link>
      </div>
    )
  }

  return (
    <section className="mt-2">
      <BillList bills={bills} />
    </section>
  )
}
