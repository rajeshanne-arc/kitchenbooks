import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { getOwed } from '@/server/dashboard-queries'
import { getBooksCompleteness, listOpenQueries } from '@/server/accountant-queries'
import { countUnaccountedMovements } from '@/server/accounts-queries'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  if (user.role === 'owner' || user.role === 'manager') return NextResponse.json({ kind: 'owner', owed: await getOwed(user.restaurantId) })
  return NextResponse.json({ kind: 'accountant', completeness: await getBooksCompleteness(user.restaurantId), openQueries: await listOpenQueries(user.restaurantId), unaccountedMovements: await countUnaccountedMovements(user.restaurantId) })
}
