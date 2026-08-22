'use server'

// Write side of sales. A fetch is an EVENT: one pos_fetches row plus orders
// and lines in one transaction; re-fetching a date inserts a new fetch that
// wins — nothing is edited. Mapping is master data with a column-granted
// upsert (recipe_id, item_name only).

import { z } from 'zod'
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { fetchPetpoojaOrders, PetpoojaError } from '@/server/petpooja'
import { normalizePayload, persistFetch, SalesIngestError } from '@/server/sales-ingest'
import { countUnmapped, getMappingCoverage, getSalesDay, listUnknownOrders } from '@/server/sales-queries'
import type { FetchDayResult, MapItemResult, PosMapRow } from '@/lib/types'
import { businessToday } from '@/server/business-day'

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
    if (input.date > await businessToday()) throw new SalesError('That date has not happened yet — pick today or earlier')

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
      prunedOrders: persisted.prunedOrders,
      skippedOtherDates: norm.skippedOtherDates,
      duplicateIds: norm.duplicateIds,
      compDisagreements: norm.compDisagreements,
      note: norm.note,
      census: norm.census,
      day,
      unknownOrders,
    }
  } catch (e) {
    return fail(e)
  }
}

// ---------------------------------------------------------------- map item

const MapSchema = z
  .object({
    posItemId: z.string().trim().min(1).max(40),
    itemName: z.string().trim().max(200),
    /** A DISH gives the department AND the cost. */
    recipeId: z.union([z.literal(''), z.string().regex(UUID)]),
    /** A STOCK ITEM gives the COST for something that is bought and resold —
     *  a bottled water is bought, stocked, issued and sold, and will never
     *  have a recipe. Without this target its cost sits inside ACTUAL
     *  consumption and is absent from THEORETICAL, so every Bar variance is
     *  wrong by the price of the drinks. */
    itemId: z.union([z.literal(''), z.string().regex(UUID)]),
    /** A DEPARTMENT alone gives the department — most of the value, and the
     *  honest answer for anything bought and resold with no item behind it. */
    sectionId: z.union([z.literal(''), z.string().regex(UUID)]),
  })

// TWO RULES, AND THEY ARE ENFORCED IN THE ACTION, NOT HERE — see mapPosItem.
// A zod `.refine()` cannot state its own refusal to a user: fail() collapses
// every ZodError to "Invalid input — nothing was saved", so the message would
// be written, shipped, and never read. This schema validates SHAPE only.
//
//   1. a row must land somewhere — a dish, a stock item or a department
//   2. AN ITEM WITHOUT A DEPARTMENT IS WORSE THAN NO MAPPING AT ALL.
//      `theoretical_food_cost` groups on `coalesce(recipes.section_id,
//      pos_item_map.section_id)`, so an item-only row has no section to
//      resolve to and lands its revenue AND its cost in the '—' Unmapped
//      bucket, where the department that actually sold it never sees either.
//      Measured on the probe tenant, rolled back: mapping water to an item
//      alone left Chinese's theoretical at 300 and propped up the Unmapped
//      bucket; adding the department moved it in, taking Chinese to 500.

export async function mapPosItem(raw: {
  posItemId: string
  itemName: string
  recipeId: string
  itemId: string
  sectionId: string
}): Promise<MapItemResult> {
  try {
    const input = MapSchema.parse(raw)

    // THE REFUSALS ARE RE-THROWN AS SalesError, and the reason is that a zod
    // `.refine()` message CANNOT REACH THE USER: fail() collapses every
    // ZodError to "Invalid input — nothing was saved". The schema's refines
    // are a correct second line and they document the rule, but on their own
    // they produce an apology that names nothing — which is how the smoke gate
    // found this, and it had been true of the older "pick a dish or a
    // department" refine since the day it was written. Same lesson as
    // AccountRefusal: a refusal nobody can read is not a refusal.
    if (input.recipeId === '' && input.itemId === '' && input.sectionId === '') {
      throw new SalesError('Pick a dish, a stock item or a department — a POS item has to land somewhere')
    }
    if (input.itemId !== '' && input.sectionId === '') {
      throw new SalesError(
        'A stock item also needs the department that sold it — its cost would otherwise land in the unmapped bucket, where the department that sold it never sees it',
      )
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      if (input.recipeId !== '') {
        const dish = await tx<{ id: string }[]>`
          select id from recipes
          where id = ${input.recipeId} and restaurant_id = ${rid} and kind = 'dish' and status = 'active'`
        if (!dish[0]) throw new SalesError('That dish no longer exists — pick another')
      }
      if (input.itemId !== '') {
        const it = await tx<{ id: string }[]>`
          select id from items
          where id = ${input.itemId} and restaurant_id = ${rid} and status = 'active'`
        if (!it[0]) throw new SalesError('That item no longer exists — pick another')
      }
      if (input.sectionId !== '') {
        const sec = await tx<{ id: string }[]>`
          select id from sections
          where id = ${input.sectionId} and restaurant_id = ${rid} and status = 'active'`
        if (!sec[0]) throw new SalesError('That department no longer exists — pick another')
      }
      // ONE ANSWER PER ROW. A dish already carries its own department and its
      // own cost, so it clears both of the others rather than sitting beside
      // them — two answers to one question is what the precedence rule exists
      // to prevent, and a third target only makes that easier to get wrong.
      //
      // An item KEEPS its section, because the two are one answer: the item
      // says what it cost, the section says where it sold, and the view needs
      // both to put the cost in front of the department that caused it.
      const recipeId = input.recipeId === '' ? null : input.recipeId
      const itemId = recipeId !== null ? null : input.itemId === '' ? null : input.itemId
      const sectionId = recipeId !== null ? null : input.sectionId === '' ? null : input.sectionId
      const [row] = await tx<{ id: string }[]>`
        insert into pos_item_map (restaurant_id, pos_item_id, item_name, recipe_id, item_id, section_id)
        values (${rid}, ${input.posItemId}, ${input.itemName === '' ? null : input.itemName},
                ${recipeId}, ${itemId}, ${sectionId})
        on conflict (restaurant_id, pos_item_id)
        do update set recipe_id = excluded.recipe_id, item_id = excluded.item_id,
                      section_id = excluded.section_id, item_name = excluded.item_name
        returning id`
      return { mapId: row.id }
    })

    const [map] = await tsql<PosMapRow[]>`
      select m.id, m.pos_item_id, m.item_name, m.recipe_id, m.section_id, m.item_id,
             r.code as recipe_code, r.name as recipe_name,
             coalesce(rs.code, ds.code) as section_code,
             coalesce(rs.name, ds.name) as section_name,
             i.code as item_code, i.name as stock_item_name
      from pos_item_map m
      left join recipes r on r.id = m.recipe_id
      left join sections rs on rs.id = r.section_id
      left join sections ds on ds.id = m.section_id
      left join items i on i.id = m.item_id
      where m.id = ${saved.mapId}`
    if (!map || (map.recipe_id === null && map.item_id === null && map.section_id === null)) {
      throw new SalesError('Could not verify the mapping after save')
    }
    const unmappedLeft = await countUnmapped(rid)
    const coverage = await getMappingCoverage(rid)
    return { ok: true, map, unmappedLeft, coverage }
  } catch (e) {
    return fail(e)
  }
}
