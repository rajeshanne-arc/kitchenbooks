'use server'

// STORAGE LOCATIONS — the write side.
//
// Manager and owner, matching Lists: this is the restaurant's own vocabulary
// for its own building, and the store manager who walks it is the person most
// likely to know the right order.
//
// RETIRE, NEVER DELETE. Items point at a location, and a deleted row would
// leave them pointing at nothing. A retired location stops being offered and
// keeps every item already placed there — the screen says how many.

import { z } from 'zod'
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { getLocation, listLocations } from '@/server/locations-queries'
import type { SaveLocationInput, StorageLocation } from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class LocationError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof LocationError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('location action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

/** A server action is a public endpoint and the route gate is not the check. */
async function actor(): Promise<void> {
  const user = await getSessionUser()
  if (!user) throw new LocationError('Sign in again — the session has expired')
  if (user.role !== 'owner' && user.role !== 'manager') {
    throw new LocationError('Only a manager or an owner can change storage locations — ask them')
  }
}

export type LocationResult = { ok: true; locations: StorageLocation[] } | { ok: false; error: string }

// The four shapes a location can have. SHAPES, not brands or temperatures —
// the same reasoning as money-account kinds, and what lets this run in a
// kitchen nobody here has seen.
const KINDS = ['ambient', 'chilled', 'frozen', 'other'] as const

const Schema = z.object({
  name: z.string().trim().min(1, 'Name the location').max(60),
  kind: z.enum(KINDS),
  note: z.string().trim().max(300),
  status: z.enum(['active', 'inactive']),
})

export async function createLocation(raw: SaveLocationInput): Promise<LocationResult> {
  try {
    await actor()
    const input = Schema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [dup] = await tx<{ id: string }[]>`
        select id from storage_locations
        where restaurant_id = ${rid} and lower(name) = lower(${input.name})`
      if (dup) throw new LocationError(`There is already a location called “${input.name}”`)
      // A NEW LOCATION GOES LAST IN THE WALK, not first: nobody knows where it
      // sits on the route until they say so, and guessing would silently
      // reorder somebody's count sheet.
      const [{ next }] = await tx<{ next: number }[]>`
        select coalesce(max(sort_order), 0) + 1 as next
        from storage_locations where restaurant_id = ${rid}`
      await tx`
        insert into storage_locations (restaurant_id, name, kind, sort_order, note, status)
        values (${rid}, ${input.name}, ${input.kind}, ${next},
                ${input.note === '' ? null : input.note}, ${input.status})`
    })
    return { ok: true, locations: await listLocations(rid) }
  } catch (e) {
    return fail(e)
  }
}

export async function updateLocation(id: string, raw: SaveLocationInput): Promise<LocationResult> {
  try {
    await actor()
    if (!UUID.test(id)) throw new LocationError('Malformed location id')
    const input = Schema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const existing = await getLocation(rid, id)
    if (!existing) throw new LocationError('Location not found — nothing was changed')
    // RETIRING ONE THAT STILL HOLDS ITEMS is allowed and said out loud rather
    // than refused: a shelf really does get emptied before its items are
    // moved. What must not happen is it going quiet — those items become
    // unplaced on the count sheet, which is the loud group at the bottom.
    await tsql`
      update storage_locations
      set name = ${input.name}, kind = ${input.kind},
          note = ${input.note === '' ? null : input.note}, status = ${input.status}
      where id = ${id} and restaurant_id = ${rid}`
    return { ok: true, locations: await listLocations(rid) }
  } catch (e) {
    return fail(e)
  }
}

/**
 * REORDERING IS THE FEATURE, not an afterthought.
 *
 * `sort_order` is the order somebody physically walks the store, and it is
 * the only reason the count sheet is faster than the paper it replaces. So
 * this renumbers the whole list 1..n first and then swaps — the same shape as
 * the Lists editor — because a swap on drifted numbers is how two rows end up
 * sharing a position and the walk quietly stops being a walk.
 */
export async function moveLocation(id: string, dir: 'up' | 'down'): Promise<LocationResult> {
  try {
    await actor()
    if (!UUID.test(id)) throw new LocationError('Malformed location id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const all = await tx<{ id: string }[]>`
        select id from storage_locations
        where restaurant_id = ${rid}
        order by sort_order asc, name asc`
      const idx = all.findIndex((l) => l.id === id)
      if (idx === -1) throw new LocationError('Location not found')
      const swapWith = dir === 'up' ? idx - 1 : idx + 1
      if (swapWith < 0 || swapWith >= all.length) return // already at the edge
      const order = all.map((l) => l.id)
      ;[order[idx], order[swapWith]] = [order[swapWith], order[idx]]
      for (const [i, lid] of order.entries()) {
        await tx`update storage_locations set sort_order = ${i + 1}
                 where id = ${lid} and restaurant_id = ${rid}`
      }
    })
    return { ok: true, locations: await listLocations(rid) }
  } catch (e) {
    return fail(e)
  }
}
