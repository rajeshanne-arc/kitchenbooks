import Link from 'next/link'
import StaffForm from '@/components/labour/StaffForm'
import { getRestaurant } from '@/server/queries'
import { getSections } from '@/server/store-queries'
import { listActiveStaff } from '@/server/labour-queries'

export const dynamic = 'force-dynamic'

export default async function NewStaffPage() {
  const restaurant = await getRestaurant()
  const [sections, people] = await Promise.all([getSections(restaurant.id), listActiveStaff(restaurant.id)])
  return (
    <div className="mt-4">
      <Link href="/books/staff" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Staff
      </Link>
      <h2 className="mt-2 text-lg font-bold text-stone-900">Add staff</h2>
      <p className="mt-0.5 text-sm text-stone-400">
        Code assigns automatically on save: <span className="font-mono">E###</span> — flat series, permanent.
      </p>
      <StaffForm existing={null} sections={sections} people={people} />
    </div>
  )
}
