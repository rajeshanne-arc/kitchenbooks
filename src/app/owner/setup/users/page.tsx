import { getRestaurant } from '@/server/queries'
import { listRestaurantMemberships, listUsers } from '@/server/auth-core'
import { listActiveStaff } from '@/server/labour-queries'
import { getSessionUser } from '@/server/current-user'
import UsersAdmin from '@/components/auth/UsersAdmin'
import AddMembershipForm from '@/components/auth/AddMembershipForm'
import MembershipsAdmin from '@/components/auth/MembershipsAdmin'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const user = await getSessionUser()
  if (user === null || user.role !== 'owner') {
    // the proxy already refused non-owners; this is the second lock
    return <p className="mt-6 text-sm text-red-700">Only an owner can manage accounts.</p>
  }
  const restaurant = await getRestaurant()
  const [users, staff] = await Promise.all([listUsers(restaurant.id), listActiveStaff(restaurant.id)])
  const memberships = process.env.KB_MEMBERSHIPS === 'true'
    ? await listRestaurantMemberships(user.username, restaurant.id)
    : []

  return (
    <section className="mt-4">
      <p className="text-sm text-stone-600">
        Accounts are keys, not people — link one to its staff row when it belongs to someone on the roster. Retire,
        never delete: an old key stops working but its name stays on everything it wrote.
      </p>
      <UsersAdmin users={users} staff={staff} self={user.username} />
      {process.env.KB_MEMBERSHIPS === 'true' && <AddMembershipForm staff={staff} />}
      {process.env.KB_MEMBERSHIPS === 'true' && <MembershipsAdmin rows={memberships} self={user.username} />}
    </section>
  )
}
