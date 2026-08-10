'use server'

// The cookie layer over auth-core. Login errors stay GENERIC — "wrong
// username or password", never which half — and failures cost a small
// delay. The session is a signed httpOnly cookie for 30 days.

import { cookies } from 'next/headers'
import { z } from 'zod'
import { getRestaurant } from '@/server/queries'
import {
  AuthError,
  createFirstOwner,
  createUser,
  resetPassword,
  updateUser,
  verifyCredentials,
} from '@/server/auth-core'
import { getSessionUser } from '@/server/current-user'
import { SESSION_COOKIE, SESSION_DAYS, signSession } from '@/lib/session'
import type { LoginResult, ResetPasswordResult, SetupResult, UserMutationResult } from '@/lib/types'

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AuthError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('auth action failed', e)
  return { ok: false, error: 'Something went wrong — nothing was saved' }
}

async function setSessionCookie(username: string, role: string) {
  const secret = process.env.KB_SESSION_SECRET
  if (!secret) throw new AuthError('KB_SESSION_SECRET is not configured')
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600
  const token = await signSession({ u: username, r: role, exp }, secret)
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 3600,
  })
}

const LoginSchema = z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) })

export async function login(raw: { username: string; password: string }): Promise<LoginResult> {
  try {
    const input = LoginSchema.parse(raw)
    const restaurant = await getRestaurant()
    const user = await verifyCredentials(restaurant.id, input.username, input.password)
    if (!user) return { ok: false, error: 'Wrong username or password' }
    await setSessionCookie(user.username, user.role)
    return { ok: true, role: user.role }
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
    await setSessionCookie(user.username, user.role)
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
