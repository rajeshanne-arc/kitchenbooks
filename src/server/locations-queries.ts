// STORAGE LOCATIONS — where stock physically sits.
//
// A MASTER, NOT A `list_options` KEY, and the reason is the same one that
// moved partners out of that table: items POINT AT a location. A rename has to
// follow every item that points at it, and nothing can point at a list value.
// Same shape as `sections`, which one row of codes a dish, receives an issue
// and posts a staff member.
//
// `sort_order` IS WALKING ORDER, not alphabetical, and that is the whole
// feature — see the edit screen, which says so. A count sheet ordered any
// other way makes somebody cross the store four times.
import 'server-only'
import { tsql } from '@/lib/db'
import type { StorageLocation } from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function listLocations(
  restaurantId: string,
  includeRetired = true,
  showClosed = false,
): Promise<StorageLocation[]> {
  return tsql<StorageLocation[]>`
    select l.id, l.name, l.kind, l.sort_order, l.note, l.status,
           (select count(*)::int from items i
            where i.storage_location_id = l.id and i.restaurant_id = ${restaurantId}
              and i.status = 'active') as item_count
    from storage_locations l
    where l.restaurant_id = ${restaurantId}
      and (${includeRetired} or l.status = 'active')
      -- ARCHIVED, NOT DELETED. A merged or discarded row leaves the browsing
      -- list and stays findable — see src/lib/closed.ts. Retired is NOT one of
      -- these: a retired row may come back and stays visible, marked.
      and (${showClosed} or l.status not in ('merged', 'discarded'))
    order by l.sort_order asc, l.name asc`
}

export async function getLocation(restaurantId: string, id: string): Promise<StorageLocation | null> {
  if (!UUID.test(id)) return null
  const rows = await tsql<StorageLocation[]>`
    select l.id, l.name, l.kind, l.sort_order, l.note, l.status,
           (select count(*)::int from items i
            where i.storage_location_id = l.id and i.restaurant_id = ${restaurantId}
              and i.status = 'active') as item_count
    from storage_locations l
    where l.restaurant_id = ${restaurantId} and l.id = ${id}`
  return rows[0] ?? null
}

/** The picker on the item form: active locations only, in walking order. */
export async function listActiveLocations(restaurantId: string): Promise<StorageLocation[]> {
  return listLocations(restaurantId, false)
}
