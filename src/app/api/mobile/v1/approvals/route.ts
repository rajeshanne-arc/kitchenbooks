import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { getWaiting } from '@/server/approvals-queries'
import { listPendingPurchaseApprovals } from '@/server/po-queries'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const [waiting, purchaseApprovals] = await Promise.all([getWaiting(user.restaurantId), listPendingPurchaseApprovals(user.restaurantId)])
  return NextResponse.json({ ...waiting, purchaseApprovals })
}
