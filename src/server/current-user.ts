// Who is at the keyboard. The proxy trusts the signed cookie for routing
// speed; ACTIONS come here, and this checks the database too — a retired
// user or a changed role takes effect on the next action, not the next
// month. Outside a request (the smoke suites) there are no cookies and the
// answer is null; entered_by then stays null, which is honest.
import 'server-only'
import { cookies, headers } from 'next/headers'
import { tsql } from '@/lib/db'
import { withTenant } from '@/lib/tenant'
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

/** @scope not-a-figure */
export async function getSessionUser(): Promise<SessionUser | null> {
  let token: string | undefined
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value
    if (!token) token = (await headers()).get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  } catch {
    return null // no request scope (smoke suites, build-time)
  }
  const secret = process.env.KB_SESSION_SECRET
  if (!secret) return null
  const payload = await verifySession(token, secret)
  if (!payload) return null
  if (process.env.KB_MEMBERSHIPS === 'true') {
    // user_accounts is deliberately hidden by RLS. Resolve the identity
    // through its narrow definer function, then resolve the tenant-scoped
    // membership through the corresponding definer function; neither lookup
    // grants kb_app direct cross-tenant access to the account table.
    const [account] = await tsql<{ username: string; display_name: string; status: string }[]>`
      select username, display_name, status
      from user_account_for_username(${payload.u})`
    const rows = await withTenant(payload.t, () => tsql<{ role: Role; restaurant_id: string; status: string }[]>`
      select role, restaurant_id, status
      from restaurant_memberships_for_username(${payload.u})
      where restaurant_id = ${payload.t} and role = ${payload.r}`)
    if (!account || account.status !== 'active' || rows.length !== 1 || rows[0].status !== 'active') return null
    return {
      username: account.username,
      displayName: account.display_name,
      role: rows[0].role,
      restaurantId: rows[0].restaurant_id,
    }
  }
  // THE ONE READ THAT CANNOT ASK THE SESSION WHICH TENANT IT IS IN, because
  // it IS the session. Left on the bare pool it would return zero rows under
  // RLS and every user would appear signed out — the empty-database outage
  // landing on the one read the sweep could not touch. Routed through txn()
  // it would recurse: txn resolves a null tenant by calling this function.
  //
  // So it announces the COOKIE'S claim and then checks the row agrees. That
  // is not trusting the claim: the token is HMAC-signed, so a forged `t`
  // never gets this far, and the row's own restaurant_id is compared below.
  // The claim narrows the read; the row decides.
  const rows = await withTenant(payload.t, () =>
    tsql<{ username: string; display_name: string; role: Role; restaurant_id: string }[]>`
      select username, display_name, role, restaurant_id from app_users
      where lower(username) = lower(${payload.u}) and status = 'active'`,
  )
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
