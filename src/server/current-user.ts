// Who is at the keyboard. The proxy trusts the signed cookie for routing
// speed; ACTIONS come here, and this checks the database too — a retired
// user or a changed role takes effect on the next action, not the next
// month. Outside a request (the smoke suites) there are no cookies and the
// answer is null; entered_by then stays null, which is honest.
import 'server-only'
import { cookies } from 'next/headers'
import { sql } from '@/lib/db'
import { SESSION_COOKIE, verifySession } from '@/lib/session'
import type { Role } from '@/lib/roles'

export type SessionUser = {
  username: string
  displayName: string
  role: Role
  /** WHICH BOOKS. Resolved from the app_users row, not from the cookie's
   *  claim, so a re-tenanted or retired account cannot keep operating on
   *  the tenant its old token named. */
  restaurantId: string
}

export async function getSessionUser(): Promise<SessionUser | null> {
  let token: string | undefined
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value
  } catch {
    return null // no request scope (smoke suites, build-time)
  }
  const secret = process.env.KB_SESSION_SECRET
  if (!secret) return null
  const payload = await verifySession(token, secret)
  if (!payload) return null
  const rows = await sql<{ username: string; display_name: string; role: Role; restaurant_id: string }[]>`
    select username, display_name, role, restaurant_id from app_users
    where lower(username) = lower(${payload.u}) and status = 'active'`
  if (rows.length !== 1) return null // ambiguous or absent is not a session
  const user = rows[0]
  if (user.role !== payload.r) return null
  // The cookie's tenant must still be the row's tenant. They can only differ
  // if the token predates a change, and a stale claim about WHICH BOOKS is
  // the one claim that must never be honoured.
  if (payload.t !== user.restaurant_id) return null
  return {
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    restaurantId: user.restaurant_id,
  }
}

/** The username that goes into entered_by everywhere. */
export async function enteredBy(): Promise<string | null> {
  const user = await getSessionUser()
  return user?.username ?? null
}
