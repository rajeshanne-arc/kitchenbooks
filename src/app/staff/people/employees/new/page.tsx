import Link from 'next/link'
import StaffForm from '@/components/labour/StaffForm'
import { getRestaurant } from '@/server/queries'
import { getAllSections } from '@/server/store-queries'
import { listActiveStaff } from '@/server/labour-queries'
import { getSessionUser } from '@/server/current-user'

export const dynamic = 'force-dynamic'

export default async function NewStaffPage() {
  const restaurant = await getRestaurant()
  const [user, sections, people] = await Promise.all([
    getSessionUser(),
    getAllSections(restaurant.id),
    listActiveStaff(restaurant.id),
  ])
  // OWNER (and accountant) ONLY. A manager does not get the block, and this
  // page does not read a single identifier column for them — LAW 1 applied to
  // a payload, not just to a link.
  const canEditIdentity = user?.role === 'owner' || user?.role === 'accountant'
  return (
    <div className="mt-4">
      <Link href="/staff/people/employees" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Staff
      </Link>
      <h2 className="mt-2 text-lg font-bold text-stone-900">Add staff</h2>
      <p className="mt-0.5 text-sm text-stone-400">
        Code assigns automatically on save: <span className="font-mono">E###</span> — flat series, permanent.
      </p>
      <StaffForm
        existing={null}
        identity={null}
        canEditIdentity={canEditIdentity}
        sections={sections}
        people={people}
      />
    </div>
  )
}
