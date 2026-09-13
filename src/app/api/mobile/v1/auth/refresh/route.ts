import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { SESSION_DAYS, signSession } from '@/lib/session'

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'session expired' }, { status: 401 })
  const secret = process.env.KB_SESSION_SECRET
  if (!secret) return NextResponse.json({ error: 'Mobile sign-in is not configured' }, { status: 503 })
  const accessToken = await signSession({
    u: user.username,
    r: user.role,
    t: user.restaurantId,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600,
  }, secret)
  const restaurant = await getRestaurant()
  return NextResponse.json({
    accessToken,
    user: {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      restaurantId: user.restaurantId,
      restaurantName: restaurant.name,
    },
  })
}
