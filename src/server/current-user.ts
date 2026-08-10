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

export type SessionUser = { username: string; displayName: string; role: Role }

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
  const rows = await sql<{ username: string; display_name: string; role: Role }[]>`
    select username, display_name, role from app_users
    where lower(username) = lower(${payload.u}) and status = 'active'`
  const user = rows[0]
  if (!user || user.role !== payload.r) return null
  return { username: user.username, displayName: user.display_name, role: user.role }
}

/** The username that goes into entered_by everywhere. */
export async function enteredBy(): Promise<string | null> {
  const user = await getSessionUser()
  return user?.username ?? null
}
