// Identity core — everything auth that does NOT need a request context, so
// the smoke suite can exercise it directly. Passwords are bcrypt-hashed;
// users are masters (retire, never delete — and the DB has no DELETE grant
// anyway). The FIRST owner is born at /setup exactly once, gated by the
// bootstrap code (the current KB_PIN — Rajesh types it at the screen;
// nothing arrives through chat), and /setup refuses forever after.
import 'server-only'
import bcrypt from 'bcryptjs'
import { sql } from '@/lib/db'
import { ALL_ROLES, type Role } from '@/lib/roles'
import type { AppUserRow } from '@/lib/types'

export class AuthError extends Error {}

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

function assertCredentialShape(username: string, password: string) {
  if (!USERNAME_RE.test(username)) {
    throw new AuthError('Username: 3–30 characters, letters/digits/dot/dash/underscore only')
  }
  if (password.length < 8) throw new AuthError('Password must be at least 8 characters')
}

const USER_SELECT = `
  select u.id, u.username, u.display_name, u.role, u.staff_id,
         st.name as staff_name, st.code as staff_code,
         u.status, u.created_at::text as created_at
  from app_users u
  left join staff st on st.id = u.staff_id`

export async function listUsers(restaurantId: string): Promise<AppUserRow[]> {
  return sql<AppUserRow[]>`
    ${sql.unsafe(USER_SELECT)}
    where u.restaurant_id = ${restaurantId}
    order by (u.status = 'active') desc, u.role asc, u.username asc`
}

export async function anyUsers(restaurantId: string): Promise<boolean> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from app_users where restaurant_id = ${restaurantId}`
  return (rows[0]?.n ?? 0) > 0
}

/** Login check. Wrong anything → null after a uniform small delay; the
 * error the caller shows stays generic on purpose. */
/**
 * The credential check RESOLVES THE TENANT rather than being told it.
 *
 * It used to take a restaurantId, which the caller got from "the oldest row
 * in restaurants" — so the password was checked against the wrong tenant's
 * users the moment there were two. Now the matched row carries the tenant,
 * and that is what the session is signed with.
 *
 * Usernames are globally unique by decision (see AGENTS.md): a person
 * belongs to exactly one restaurant. Until the unique index lands this
 * REFUSES a username that matches in more than one tenant rather than
 * picking one — an ambiguous login is not a login.
 */
export async function verifyCredentials(
  username: string,
  password: string,
): Promise<(AppUserRow & { restaurant_id: string }) | null> {
  const rows = await sql<(AppUserRow & { password_hash: string; restaurant_id: string })[]>`
    select u.id, u.username, u.display_name, u.role, u.staff_id,
           null as staff_name, null as staff_code,
           u.status, u.created_at::text as created_at, u.password_hash,
           u.restaurant_id
    from app_users u
    where lower(u.username) = lower(${username}) and u.status = 'active'`
  if (rows.length > 1) {
    await sleep(350)
    return null
  }
  const user = rows[0]
  const ok = user !== undefined && (await bcrypt.compare(password, user.password_hash))
  if (!ok) {
    await sleep(350)
    return null
  }
  const { password_hash: _drop, ...rest } = user
  void _drop
  return rest
}

/** The bootstrap: exactly one first owner, gated by the bootstrap code
 * (current KB_PIN env). After any user exists this refuses forever. */
export async function createFirstOwner(
  restaurantId: string,
  input: { username: string; displayName: string; password: string; bootstrapCode: string },
): Promise<AppUserRow> {
  const username = input.username.trim().toLowerCase()
  const displayName = input.displayName.trim()
  assertCredentialShape(username, input.password)
  if (displayName === '') throw new AuthError('A display name is required')
  const pin = process.env.KB_PIN
  if (!pin) throw new AuthError('Bootstrap is not available — KB_PIN is not configured in this environment')
  if (input.bootstrapCode.trim() !== pin) {
    await sleep(350)
    throw new AuthError('Bootstrap code is wrong — it is the current door PIN')
  }

  const hash = await hashPassword(input.password)
  const created = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${restaurantId}, 0))`
    const existing = await tx<{ id: string }[]>`
      select id from app_users where restaurant_id = ${restaurantId} limit 1`
    if (existing[0]) {
      throw new AuthError('Accounts already exist — /setup is closed forever; ask an owner to add you')
    }
    const [row] = await tx<{ id: string }[]>`
      insert into app_users (restaurant_id, username, display_name, role, password_hash)
      values (${restaurantId}, ${username}, ${displayName}, 'owner', ${hash})
      returning id`
    return row.id
  })

  const rows = await sql<AppUserRow[]>`${sql.unsafe(USER_SELECT)} where u.id = ${created}`
  if (!rows[0]) throw new AuthError('Could not read the owner back after setup')
  return rows[0]
}

// ------------------------------------------------------- owner-only admin

function assertOwner(actorRole: Role) {
  if (actorRole !== 'owner') throw new AuthError('Only an owner can manage accounts — ask Rajesh')
}

function assertRole(role: string): asserts role is Role {
  if (!ALL_ROLES.includes(role as Role)) throw new AuthError('Unknown role')
}

export async function createUser(
  actorRole: Role,
  restaurantId: string,
  input: { username: string; displayName: string; role: string; password: string; staffId: string },
): Promise<AppUserRow> {
  assertOwner(actorRole)
  const username = input.username.trim().toLowerCase()
  const displayName = input.displayName.trim()
  assertCredentialShape(username, input.password)
  assertRole(input.role)
  if (displayName === '') throw new AuthError('A display name is required')

  const hash = await hashPassword(input.password)
  const created = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${restaurantId}, 0))`
    const dup = await tx<{ id: string }[]>`
      select id from app_users where restaurant_id = ${restaurantId} and lower(username) = ${username} limit 1`
    if (dup[0]) throw new AuthError('That username is taken')
    if (input.staffId !== '') {
      const st = await tx<{ id: string }[]>`
        select id from staff where id = ${input.staffId} and restaurant_id = ${restaurantId}`
      if (!st[0]) throw new AuthError('Staff link not found')
    }
    const [row] = await tx<{ id: string }[]>`
      insert into app_users (restaurant_id, username, display_name, role, staff_id, password_hash)
      values (${restaurantId}, ${username}, ${displayName}, ${input.role},
              ${input.staffId === '' ? null : input.staffId}, ${hash})
      returning id`
    return row.id
  })
  const rows = await sql<AppUserRow[]>`${sql.unsafe(USER_SELECT)} where u.id = ${created}`
  if (!rows[0]) throw new AuthError('Could not read the user back after save')
  return rows[0]
}

/** Update the granted columns. The last active owner can be neither
 * retired nor demoted — the books must always have an owner with a key. */
export async function updateUser(
  actorRole: Role,
  restaurantId: string,
  userId: string,
  input: { displayName: string; role: string; staffId: string; status: 'active' | 'inactive' },
): Promise<AppUserRow> {
  assertOwner(actorRole)
  assertRole(input.role)
  const displayName = input.displayName.trim()
  if (displayName === '') throw new AuthError('A display name is required')

  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${restaurantId}, 0))`
    const [target] = await tx<{ id: string; role: Role; status: string }[]>`
      select id, role, status from app_users where id = ${userId} and restaurant_id = ${restaurantId}`
    if (!target) throw new AuthError('User not found')
    const losesOwner = target.role === 'owner' && (input.role !== 'owner' || input.status === 'inactive')
    if (losesOwner) {
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int as n from app_users
        where restaurant_id = ${restaurantId} and role = 'owner' and status = 'active' and id <> ${userId}`
      if (n === 0) throw new AuthError('This is the last active owner — make someone else an owner first')
    }
    if (input.staffId !== '') {
      const st = await tx<{ id: string }[]>`
        select id from staff where id = ${input.staffId} and restaurant_id = ${restaurantId}`
      if (!st[0]) throw new AuthError('Staff link not found')
    }
    // TENANT-SCOPED, and this one mattered most of the ten: without it an
    // owner of tenant #1 could change the role or status of tenant #2's
    // user — a cross-tenant write on the table that decides who may do
    // anything at all.
    const [changed] = await tx<{ id: string }[]>`
      update app_users
      set display_name = ${displayName}, role = ${input.role},
          staff_id = ${input.staffId === '' ? null : input.staffId}, status = ${input.status}
      where id = ${userId} and restaurant_id = ${restaurantId}
      returning id`
    if (!changed) throw new AuthError('User not found')
  })
  const rows = await sql<AppUserRow[]>`
    ${sql.unsafe(USER_SELECT)} where u.id = ${userId} and u.restaurant_id = ${restaurantId}`
  if (!rows[0]) throw new AuthError('Could not read the user back after save')
  return rows[0]
}

export async function resetPassword(
  actorRole: Role,
  restaurantId: string,
  userId: string,
  newPassword: string,
): Promise<void> {
  assertOwner(actorRole)
  if (newPassword.length < 8) throw new AuthError('Password must be at least 8 characters')
  const hash = await hashPassword(newPassword)
  const rows = await sql<{ id: string }[]>`
    update app_users set password_hash = ${hash}
    where id = ${userId} and restaurant_id = ${restaurantId}
    returning id`
  if (!rows[0]) throw new AuthError('User not found')
}
