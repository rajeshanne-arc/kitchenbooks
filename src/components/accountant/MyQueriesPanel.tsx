// The server half of MyQueries: resolves who is signed in and what they are
// being asked, so a group home renders <MyQueriesPanel /> and nothing else.
//
// Renders NOTHING when there is nothing to answer. A permanent empty
// "Questions: 0" card is a thing to read and dismiss every morning; absence
// is quieter and means the same.
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { listQueriesForRole } from '@/server/accountant-queries'
import MyQueries from '@/components/accountant/MyQueries'

export default async function MyQueriesPanel() {
  const user = await getSessionUser()
  if (!user) return null
  const restaurant = await getRestaurant()
  const queries = await listQueriesForRole(restaurant.id, user.role)
  if (queries.length === 0) return null
  return <MyQueries queries={queries} />
}
