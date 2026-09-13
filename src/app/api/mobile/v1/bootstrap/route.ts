import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { businessToday } from '@/server/business-day'
import { getStockBadge } from '@/server/store-queries'
import { countMissingCloses } from '@/server/cashier-queries'
import { countWaiting } from '@/server/approvals-queries'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const [restaurant, date, stock, missingCloses, approvals] = await Promise.all([
    getRestaurant(), businessToday(), getStockBadge(user.restaurantId), countMissingCloses(user.restaurantId), countWaiting(user.restaurantId),
  ])
  return NextResponse.json({
    date,
    user: { username: user.username, displayName: user.displayName, role: user.role, restaurantId: user.restaurantId, restaurantName: restaurant.name },
    alerts: { negativeStock: stock.negative, unacceptedStock: stock.unaccepted, reorderStock: stock.reorder, missingCloses, approvals },
  })
}
