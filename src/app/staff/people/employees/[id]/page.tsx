import Link from 'next/link'
import { notFound } from 'next/navigation'
import StaffForm from '@/components/labour/StaffForm'
import { getRestaurant } from '@/server/queries'
import { getAllSections } from '@/server/store-queries'
import { getStaffDetail, listActiveStaff } from '@/server/labour-queries'
import { getStaffIdentity } from '@/server/payroll-queries'
import { getSessionUser } from '@/server/current-user'
import { RetiredBadge } from '@/components/books/Badges'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const staff = await getStaffDetail(restaurant.id, id)
  if (!staff) notFound()

  const [user, sections, people] = await Promise.all([
    getSessionUser(),
    getAllSections(restaurant.id),
    listActiveStaff(restaurant.id),
  ])
  // OWNER (and accountant) ONLY, and the READ is gated as well as the render:
  // StaffRow crosses the wire to a manager on this same screen, so a bank
  // account number must not be in the payload at all.
  const canEditIdentity = user?.role === 'owner' || user?.role === 'accountant'
  const identity = canEditIdentity ? await getStaffIdentity(restaurant.id, id) : null

  return (
    <div className="mt-4">
      <Link href="/staff/people/employees" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Staff
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded bg-stone-900 px-2 py-0.5 font-mono text-xs font-medium text-white">{staff.code}</code>
        <h2 className="text-lg font-bold text-stone-900">{staff.name}</h2>
        {staff.status === 'inactive' && <RetiredBadge />}
        {staff.reports_to_name !== null && (
          <span className="text-xs text-stone-400">reports to {staff.reports_to_name}</span>
        )}
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
