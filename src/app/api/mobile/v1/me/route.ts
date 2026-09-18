import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const restaurant = await getRestaurant()
  return NextResponse.json({
    user: {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      restaurantId: user.restaurantId,
      restaurantName: restaurant.name,
    },
  })
}
