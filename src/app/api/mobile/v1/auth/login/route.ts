import { NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyCredentials, verifyGlobalCredentials } from '@/server/auth-core'
import { signSession, SESSION_DAYS } from '@/lib/session'

const LoginSchema = z.object({
  username: z.string().trim().min(1).max(60),
  password: z.string().min(1).max(200),
})

/**
 * Mobile authentication deliberately returns the same signed session payload
 * the web app uses, but in a response body because native clients do not rely
 * on a browser cookie jar. The credential verification remains in auth-core;
 * this route adds no second password or tenant rule.
 */
export async function POST(request: Request) {
  try {
    const input = LoginSchema.parse(await request.json())
    let identity: { username: string; displayName: string; role: string; restaurantId: string; restaurantName: string } | null = null

    if (process.env.KB_MEMBERSHIPS === 'true') {
      const global = await verifyGlobalCredentials(input.username, input.password)
      if (global && global.choices.length === 1) {
        const choice = global.choices[0]
        identity = {
          username: global.username,
          displayName: global.displayName,
          role: choice.role,
          restaurantId: choice.restaurantId,
          restaurantName: choice.restaurantName,
        }
      }
    } else {
      const user = await verifyCredentials(input.username, input.password)
      if (user) {
        const { tsql } = await import('@/lib/db')
        const [restaurant] = await tsql<{ name: string }[]>`
          select name from restaurants where id = ${user.restaurant_id}`
        identity = {
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          restaurantId: user.restaurant_id,
          restaurantName: restaurant?.name ?? 'KitchenBooks',
        }
      }
    }

    if (!identity) return NextResponse.json({ error: 'Wrong username or password' }, { status: 401 })
    const secret = process.env.KB_SESSION_SECRET
    if (!secret) return NextResponse.json({ error: 'Mobile sign-in is not configured' }, { status: 503 })
    const accessToken = await signSession({
      u: identity.username,
      r: identity.role,
      t: identity.restaurantId,
      exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600,
    }, secret)
    return NextResponse.json({ session: { ...identity, accessToken } })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid sign-in details' }, { status: 400 })
    console.error('mobile login failed', error)
    return NextResponse.json({ error: 'Unable to sign in' }, { status: 500 })
  }
}
