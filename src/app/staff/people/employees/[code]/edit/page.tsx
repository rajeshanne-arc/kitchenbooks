import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import StaffForm from '@/components/labour/StaffForm'
import { getRestaurant } from '@/server/queries'
import { getAllSections } from '@/server/store-queries'
import { listActiveStaff } from '@/server/labour-queries'
import { getStaffByRef } from '@/server/staff-profile-queries'
import { getStaffIdentity } from '@/server/payroll-queries'
import { getSessionUser } from '@/server/current-user'
import { RetiredBadge } from '@/components/books/Badges'

export const dynamic = 'force-dynamic'

export default async function StaffEditPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const restaurant = await getRestaurant()
  const staff = await getStaffByRef(restaurant.id, decodeURIComponent(code))
  if (!staff) notFound()
  // ONE ADDRESS PER PERSON. The old edit URL carried the uuid and phones may
  // have it bookmarked, so it still resolves — and then redirects to the code,
  // rather than the app serving two addresses for one person forever.
  if (decodeURIComponent(code).toLowerCase() !== staff.code.toLowerCase()) {
    redirect(`/staff/people/employees/${staff.code}/edit`)
  }

  const [user, sections, people] = await Promise.all([
    getSessionUser(),
    getAllSections(restaurant.id),
    listActiveStaff(restaurant.id),
  ])
  // OWNER (and accountant) ONLY, and the READ is gated as well as the render:
  // StaffRow crosses the wire to a manager on this same screen, so a bank
  // account number must not be in the payload at all.
  const canEditIdentity = user?.role === 'owner' || user?.role === 'accountant'
  const identity = canEditIdentity ? await getStaffIdentity(restaurant.id, staff.id) : null

  return (
    <div className="mt-4">
      <Link
        href={`/staff/people/employees/${staff.code}`}
        className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800"
      >
        ← {staff.name}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded bg-stone-900 px-2 py-0.5 font-mono text-xs font-medium text-white">{staff.code}</code>
        <h2 className="text-lg font-bold text-stone-900">Edit {staff.name}</h2>
        {staff.status === 'inactive' && <RetiredBadge />}
      </div>
      <StaffForm
        existing={staff}
        identity={identity}
        canEditIdentity={canEditIdentity}
        sections={sections}
        people={people}
      />
    </div>
  )
}
