'use server'

// Write side of sales. A fetch is an EVENT: one pos_fetches row plus orders
// and lines in one transaction; re-fetching a date inserts a new fetch that
// wins — nothing is edited. Mapping is master data with a column-granted
// upsert (recipe_id, item_name only).

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { fetchPetpoojaOrders, PetpoojaError } from '@/server/petpooja'
import { normalizePayload, persistFetch, SalesIngestError } from '@/server/sales-ingest'
import { countUnmapped, getSalesDay, listUnknownOrders } from '@/server/sales-queries'
import { todayIST } from '@/server/store-queries'
import type { FetchDayResult, MapItemResult, PosMapRow } from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

class SalesError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof SalesError || e instanceof PetpoojaError || e instanceof SalesIngestError) {
    return { ok: false, error: e.message }
  }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('sales action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

function assertRealDate(s: string, label: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new SalesError(`${label} is not a real calendar date`)
  }
  const year = Number(s.slice(0, 4))
  if (year < 2000 || year > 2100) throw new SalesError(`${label} is out of range`)
}

// ---------------------------------------------------------------- fetch day

const FetchSchema = z.object({ date: z.string().regex(DATE_RE) })

export async function fetchDay(raw: { date: string }): Promise<FetchDayResult> {
  try {
    const input = FetchSchema.parse(raw)
    assertRealDate(input.date, 'Business date')
    if (input.date > todayIST()) throw new SalesError('That date has not happened yet — pick today or earlier')

    const restaurant = await getRestaurant()
    const payload = await fetchPetpoojaOrders(input.date)
    const norm = normalizePayload(payload, input.date)
    const persisted = await persistFetch(restaurant.id, input.date, norm)

    // Post-save figures are read back from the DB, never echoed from input.
    const day = await getSalesDay(restaurant.id, input.date)
    const unknownOrders =
      day !== null && day.unknown_status > 0
        ? (await listUnknownOrders(restaurant.id)).filter((u) => u.business_date === input.date)
        : []

    return {
      ok: true,
      fetchId: persisted.fetchId,
      businessDate: input.date,
      apiOrderCount: norm.apiOrderCount,
      insertedOrders: persisted.insertedOrders,
      skippedOtherDates: norm.skippedOtherDates,
      duplicateIds: norm.duplicateIds,
      compDisagreements: norm.compDisagreements,
      note: norm.note,
      day,
      unknownOrders,
    }
  } catch (e) {
    return fail(e)
  }
}

// ---------------------------------------------------------------- map item

const MapSchema = z.object({
  posItemId: z.string().trim().min(1).max(40),
  itemName: z.string().trim().max(200),
  recipeId: z.string().regex(UUID),
})

export async function mapPosItem(raw: {
  posItemId: string
  itemName: string
  recipeId: string
}): Promise<MapItemResult> {
  try {
    const input = MapSchema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const dish = await tx<{ id: string }[]>`
        select id from recipes
        where id = ${input.recipeId} and restaurant_id = ${rid} and kind = 'dish' and status = 'active'`
      if (!dish[0]) throw new SalesError('Pick a dish — POS items map to dishes, and the dish carries the section')
      const [row] = await tx<{ id: string }[]>`
        insert into pos_item_map (restaurant_id, pos_item_id, item_name, recipe_id)
        values (${rid}, ${input.posItemId}, ${input.itemName === '' ? null : input.itemName}, ${input.recipeId})
        on conflict (restaurant_id, pos_item_id)
        do update set recipe_id = excluded.recipe_id, item_name = excluded.item_name
        returning id`
      return { mapId: row.id }
    })

    const [map] = await sql<PosMapRow[]>`
      select m.id, m.pos_item_id, m.item_name, m.recipe_id,
             r.code as recipe_code, r.name as recipe_name, s.code as section_code
      from pos_item_map m
      left join recipes r on r.id = m.recipe_id
      left join sections s on s.id = r.section_id
      where m.id = ${saved.mapId}`
    if (!map || map.recipe_id === null) throw new SalesError('Could not verify the mapping after save')
    const unmappedLeft = await countUnmapped(rid)
    return { ok: true, map, unmappedLeft }
  } catch (e) {
    return fail(e)
  }
}
