'use server'

// The cookie layer over auth-core. Login errors stay GENERIC — "wrong
// username or password", never which half — and failures cost a small
// delay. The session is a signed httpOnly cookie for 30 days.

import { cookies } from 'next/headers'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { getRestaurant } from '@/server/queries'
import {
  AuthError,
  changeOwnPassword,
  createFirstOwner,
  createUser,
  resetPassword,
  listAvailableRestaurants,
  setRestaurantMembershipStatus,
  updateUser,
  verifyCredentials,
  verifyGlobalCredentials,
} from '@/server/auth-core'
import { getSessionUser } from '@/server/current-user'
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from '@/lib/session'
import type { LoginResult, ResetPasswordResult, SetupResult, UserMutationResult } from '@/lib/types'

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AuthError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('auth action failed', e)
  return { ok: false, error: 'Something went wrong — nothing was saved' }
}

async function setSessionCookie(username: string, role: string, restaurantId: string) {
  const secret = process.env.KB_SESSION_SECRET
  if (!secret) throw new AuthError('KB_SESSION_SECRET is not configured')
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600
  const token = await signSession({ u: username, r: role, t: restaurantId, exp }, secret)
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 3600,
  })
}

const PENDING_LOGIN_COOKIE = 'kb_pending_login'
const PENDING_TENANT = '00000000-0000-0000-0000-000000000000'

async function setPendingLoginCookie(username: string) {
  const secret = process.env.KB_SESSION_SECRET
  if (!secret) throw new AuthError('KB_SESSION_SECRET is not configured')
  const token = await signSession({ u: username, r: 'pending', t: PENDING_TENANT, exp: Math.floor(Date.now() / 1000) + 5 * 60 }, secret)
  ;(await cookies()).set(PENDING_LOGIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 5 * 60,
  })
}

const LoginSchema = z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) })

export async function login(raw: { username: string; password: string }): Promise<LoginResult> {
  try {
    const input = LoginSchema.parse(raw)
    // No getRestaurant() here on purpose: the credentials RESOLVE the
    // tenant. Asking which restaurant before knowing who is asking was the
    // fault — it answered "the oldest one" every time.
    if (process.env.KB_MEMBERSHIPS === 'true') {
      const global = await verifyGlobalCredentials(input.username, input.password)
      if (!global) return { ok: false, error: 'Wrong username or password' }
      if (global.choices.length > 1) {
        await setPendingLoginCookie(global.username)
        return { ok: 'choose-restaurant', choices: global.choices }
      }
      const choice = global.choices[0]
      await setSessionCookie(global.username, choice.role, choice.restaurantId)
      return { ok: true, role: choice.role }
    }
    const user = await verifyCredentials(input.username, input.password)
    if (!user) return { ok: false, error: 'Wrong username or password' }
    await setSessionCookie(user.username, user.role, user.restaurant_id)
    return { ok: true, role: user.role }
  } catch (e) {
    return fail(e)
  }
}

export async function selectRestaurant(restaurantId: string): Promise<{ ok: true; role: string } | { ok: false; error: string }> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(restaurantId)) throw new AuthError('Choose a valid restaurant')
    const secret = process.env.KB_SESSION_SECRET
    if (!secret) throw new AuthError('KB_SESSION_SECRET is not configured')
    const jar = await cookies()
    const pending = await verifySession(jar.get(PENDING_LOGIN_COOKIE)?.value, secret)
    if (!pending || pending.r !== 'pending' || pending.t !== PENDING_TENANT) {
      throw new AuthError('Your sign-in choice expired — please sign in again')
    }
    const { tsql } = await import('@/lib/db')
    const choices = await tsql<{ restaurant_id: string; role: string }[]>`
      select restaurant_id, role from restaurant_memberships_for_username(${pending.u})
      where restaurant_id = ${restaurantId}`
    if (!choices[0]) throw new AuthError('That restaurant is not available to your account')
    await setSessionCookie(pending.u, choices[0].role, restaurantId)
    jar.delete(PENDING_LOGIN_COOKIE)
    return { ok: true, role: choices[0].role }
  } catch (e) {
    return fail(e)
  }
}

export async function switchRestaurantAction(restaurantId: string): Promise<{ ok: true; role: string } | { ok: false; error: string }> {
  try {
    if (process.env.KB_MEMBERSHIPS !== 'true') throw new AuthError('Restaurant switching is not enabled')
    if (!/^[0-9a-f-]{36}$/i.test(restaurantId)) throw new AuthError('Choose a valid restaurant')
    const user = await getSessionUser()
    if (!user) throw new AuthError('Your session has expired — sign in again')
    const choices = await listAvailableRestaurants(user.username)
    const choice = choices.find((item) => item.restaurantId === restaurantId)
    if (!choice) throw new AuthError('That restaurant is not available to your account')
    await setSessionCookie(user.username, choice.role, choice.restaurantId)
    return { ok: true, role: choice.role }
  } catch (e) {
    return fail(e)
  }
}

export async function logout(): Promise<{ ok: true }> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  return { ok: true }
}

const SetupSchema = z.object({
  username: z.string().trim().min(1).max(60),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
  bootstrapCode: z.string().trim().min(1).max(20),
})

export async function setupFirstOwner(raw: {
  username: string
  displayName: string
  password: string
  bootstrapCode: string
}): Promise<SetupResult> {
  try {
    const input = SetupSchema.parse(raw)
    const restaurant = await getRestaurant()
    const user = await createFirstOwner(restaurant.id, input)
    // /setup has no session yet, so getRestaurant() answers from the
    // single-restaurant fallback — which refuses once a second tenant
    // exists. Bootstrap for a new tenant will name its restaurant
    // explicitly when provisioning lands in Phase 3.
    await setSessionCookie(user.username, user.role, restaurant.id)
    return { ok: true, username: user.username }
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------------- user management

async function actorRole() {
  const user = await getSessionUser()
  if (!user) throw new AuthError('Not signed in')
  return user.role
}

const NewUserSchema = z.object({
  username: z.string().trim().max(60),
  displayName: z.string().trim().max(80),
  role: z.string(),
  password: z.string().max(200),
  staffId: z.string().trim().max(40),
})

export async function createUserAction(raw: {
  username: string
  displayName: string
  role: string
  password: string
  staffId: string
}): Promise<UserMutationResult> {
  try {
    const input = NewUserSchema.parse(raw)
    const restaurant = await getRestaurant()
    const user = await createUser(await actorRole(), restaurant.id, input)
    return { ok: true, user }
  } catch (e) {
    return fail(e)
  }
}

const EditUserSchema = z.object({
  displayName: z.string().trim().max(80),
  role: z.string(),
  staffId: z.string().trim().max(40),
  status: z.enum(['active', 'inactive']),
})

export async function updateUserAction(
  userId: string,
  raw: { displayName: string; role: string; staffId: string; status: 'active' | 'inactive' },
): Promise<UserMutationResult> {
  try {
    const input = EditUserSchema.parse(raw)
    const restaurant = await getRestaurant()
    const user = await updateUser(await actorRole(), restaurant.id, userId, input)
    return { ok: true, user }
  } catch (e) {
    return fail(e)
  }
}

export async function resetPasswordAction(userId: string, newPassword: string): Promise<ResetPasswordResult> {
  try {
    const restaurant = await getRestaurant()
    await resetPassword(await actorRole(), restaurant.id, userId, String(newPassword))
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function changeOwnPasswordAction(raw: {
  currentPassword: string
  newPassword: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(1).max(200),
    }).parse(raw)
    const user = await getSessionUser()
    if (!user) throw new AuthError('Not signed in')
    await changeOwnPassword(user.restaurantId, user.username, input.currentPassword, input.newPassword)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function addMembershipAction(raw: {
  username: string
  role: string
  staffId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = z.object({
      username: z.string().trim().min(3).max(60),
      role: z.string(),
      staffId: z.string().trim().max(40),
    }).parse(raw)
    const actor = await getSessionUser()
    if (!actor || actor.role !== 'owner') throw new AuthError('Only an owner can add restaurant access')
    const restaurant = await getRestaurant()
    const { tsql } = await import('@/lib/db')
    await tsql`
      select add_restaurant_membership(
        ${actor.username}, ${restaurant.id}, ${input.username}, ${input.role},
        ${input.staffId === '' ? null : input.staffId}::uuid
      )`
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function issueRestaurantInvitationAction(raw: {
  username: string
  displayName: string
  role: string
  staffId: string
}): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    const input = z.object({
      username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/),
      displayName: z.string().trim().min(1).max(80),
      role: z.string(),
      staffId: z.string().trim().max(40),
    }).parse(raw)
    const actor = await getSessionUser()
    if (!actor || actor.role !== 'owner') throw new AuthError('Only an owner can issue invitations')
    const restaurant = await getRestaurant()
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const { tsql } = await import('@/lib/db')
    await tsql`
      select issue_restaurant_invitation(
        ${actor.username}, ${restaurant.id}, ${input.username}, ${input.displayName}, ${input.role},
        ${input.staffId === '' ? null : input.staffId}::uuid, ${tokenHash}, now() + interval '48 hours'
      )`
    return { ok: true, token }
  } catch (e) {
    return fail(e)
  }
}

export async function setMembershipStatusAction(
  membershipId: string,
  status: 'active' | 'inactive',
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(membershipId)) throw new AuthError('Membership not found')
    const actor = await getSessionUser()
    if (!actor || actor.role !== 'owner') throw new AuthError('Only an owner can change restaurant access')
    const restaurant = await getRestaurant()
    await setRestaurantMembershipStatus(actor.username, restaurant.id, membershipId, status)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function issuePasswordResetLinkAction(userId: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new AuthError('User not found')
    const actor = await getSessionUser()
    if (!actor || actor.role !== 'owner') throw new AuthError('Only an owner can issue reset links')
    const restaurant = await getRestaurant()
    const { tsql } = await import('@/lib/db')
    const [target] = await tsql<{ username: string }[]>`
      select username from app_users where id = ${userId} and restaurant_id = ${restaurant.id} and status = 'active'`
    if (!target) throw new AuthError('User not found')
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await tsql`
      select issue_password_reset_token(
        ${actor.username}, ${restaurant.id}, ${target.username}, ${tokenHash}, now() + interval '30 minutes'
      )`
    return { ok: true, token }
  } catch (e) {
    return fail(e)
  }
}

export async function resetPasswordWithTokenAction(raw: {
  token: string
  newPassword: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = z.object({ token: z.string().min(40).max(100), newPassword: z.string().min(8).max(200) }).parse(raw)
    const tokenHash = createHash('sha256').update(input.token).digest('hex')
    const hash = await (await import('@/server/auth-core')).hashPassword(input.newPassword)
    const { tsql } = await import('@/lib/db')
    await tsql`select consume_password_reset_token(${tokenHash}, ${hash})`
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function acceptRestaurantInvitationAction(raw: {
  token: string
  password: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = z.object({ token: z.string().min(40).max(100), password: z.string().min(8).max(200) }).parse(raw)
    const tokenHash = createHash('sha256').update(input.token).digest('hex')
    const hash = await (await import('@/server/auth-core')).hashPassword(input.password)
    const { tsql } = await import('@/lib/db')
    await tsql`select * from accept_restaurant_invitation(${tokenHash}, ${hash})`
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
