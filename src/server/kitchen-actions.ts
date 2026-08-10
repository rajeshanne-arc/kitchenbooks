'use server'

// Write side of the kitchen truth — INSERT-only, as always.
//   Closings: VALUE per section per date; a correction is a re-file — a new
//   row that wins in kitchen_closing_current, filings visible as the
//   corrected marker. Never an edit.
//   Kitchen wastage: the VALUE is required and is what the chef states —
//   item + qty are optional detail, always as a pair. Voids are negative
//   twins copying value (and qty) EXACTLY.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { enteredBy } from '@/server/current-user'
import { getClosingCurrent, getKitchenWastageById } from '@/server/kitchen-queries'
import { decimalStringToPaise, parseMoney, parseQty } from '@/lib/money'
import type {
  SaveClosingInput,
  SaveClosingResult,
  SaveKitchenWastageInput,
  SaveKitchenWastageResult,
  VoidKitchenWastageResult,
} from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const moneyStr = z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'plain amount, up to 2 decimals')

class KitchenError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof KitchenError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('kitchen action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

function assertRealDate(s: string, label: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new KitchenError(`${label} is not a real calendar date`)
  }
  const year = Number(s.slice(0, 4))
  if (year < 2000 || year > 2100) throw new KitchenError(`${label} is out of range`)
}

async function assertKitchenSection(restaurantId: string, sectionId: string): Promise<void> {
  const rows = await sql<{ id: string }[]>`
    select id from sections
    where id = ${sectionId} and restaurant_id = ${restaurantId} and status = 'active'
      and dept_group in ('Kitchen', 'Bar')`
  if (!rows[0]) throw new KitchenError('Pick a kitchen or bar section')
}

// ------------------------------------------------------------ save closing

const ClosingSchema = z.object({
  date: z.string().regex(DATE_RE),
  sectionId: z.string().regex(UUID),
  value: moneyStr,
  note: z.string().trim().max(300),
})

export async function saveClosing(raw: SaveClosingInput): Promise<SaveClosingResult> {
  try {
    const input = ClosingSchema.parse(raw)
    assertRealDate(input.date, 'Closing date')
    // zero is a real closing — an empty section is information
    if (parseMoney(input.value) === null) throw new KitchenError('Closing value must be a plain amount')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    await assertKitchenSection(rid, input.sectionId)
    const by = await enteredBy()

    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      await tx`
        insert into kitchen_closings (restaurant_id, section_id, close_date, closing_value, note, entered_by)
        values (${rid}, ${input.sectionId}, ${input.date}, ${input.value}, ${input.note === '' ? null : input.note}, ${by})`
    })

    // Read back the winning row; it must be the one just saved.
    const closing = await getClosingCurrent(rid, input.sectionId, input.date)
    if (!closing) throw new KitchenError('Could not read the closing back after save')
    if (decimalStringToPaise(closing.closing_value) !== parseMoney(input.value)) {
      throw new KitchenError('Verification failed: the winning closing is not the one just saved')
    }
    return { ok: true, closing }
  } catch (e) {
    return fail(e)
  }
}

// ---------------------------------------------------- save kitchen wastage

const KwSchema = z.object({
  date: z.string().regex(DATE_RE),
  sectionId: z.string().regex(UUID),
  value: moneyStr,
  reason: z.string().trim().min(1, 'A reason is required').max(60),
  itemId: z.union([z.literal(''), z.string().regex(UUID)]),
  qty: z.string().trim().max(12),
  note: z.string().trim().max(300),
})

export async function saveKitchenWastage(raw: SaveKitchenWastageInput): Promise<SaveKitchenWastageResult> {
  try {
    const input = KwSchema.parse(raw)
    assertRealDate(input.date, 'Wastage date')
    const value = parseMoney(input.value)
    if (value === null || value <= 0) throw new KitchenError('Value must be more than zero — what did the loss cost?')
    if (input.itemId !== '' && input.qty === '') throw new KitchenError('An item needs its quantity')
    if (input.itemId === '' && input.qty !== '') throw new KitchenError('A quantity needs its item')
    if (input.qty !== '') {
      const q = parseQty(input.qty)
      if (q === null || q <= 0) throw new KitchenError('Quantity must be a plain number more than zero')
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await assertKitchenSection(rid, input.sectionId)
    const by = await enteredBy()
    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      if (input.itemId !== '') {
        const item = await tx<{ id: string }[]>`
          select id from items where id = ${input.itemId} and restaurant_id = ${rid} and status = 'active'`
        if (!item[0]) throw new KitchenError('Item not found')
      }
      const [row] = await tx<{ id: string }[]>`
        insert into kitchen_wastage (restaurant_id, section_id, waste_date, item_id, qty, value, reason, note, entered_by)
        values (${rid}, ${input.sectionId}, ${input.date},
                ${input.itemId === '' ? null : input.itemId}, ${input.qty === '' ? null : input.qty},
                ${input.value}, ${input.reason}, ${input.note === '' ? null : input.note}, ${by})
        returning id`
      return { id: row.id }
    })

    const wastage = await getKitchenWastageById(rid, saved.id)
    if (!wastage) throw new KitchenError('Could not verify the save — wastage missing after commit')
    return { ok: true, wastage }
  } catch (e) {
    return fail(e)
  }
}

// ---------------------------------------------------- void kitchen wastage

export async function voidKitchenWastage(id: string): Promise<VoidKitchenWastageResult> {
  try {
    if (!UUID.test(id)) throw new KitchenError('Malformed wastage id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [orig] = await tx<{ id: string; reverses_id: string | null }[]>`
        select id, reverses_id from kitchen_wastage where id = ${id} and restaurant_id = ${rid}`
      if (!orig) throw new KitchenError('Wastage entry not found')
      if (orig.reverses_id !== null) throw new KitchenError('This is a reversal — reversals cannot be voided')
      const already = await tx<{ id: string }[]>`
        select id from kitchen_wastage where reverses_id = ${id} limit 1`
      if (already[0]) throw new KitchenError('This entry is already voided')

      // Negative twin: value (and qty) copied EXACTLY, sign flipped.
      const [rev] = await tx<{ id: string }[]>`
        insert into kitchen_wastage (restaurant_id, section_id, waste_date, item_id, qty, value, reason, note, reverses_id, entered_by)
        select restaurant_id, section_id, waste_date, item_id, -qty, -value, reason, 'void', id, ${by}
        from kitchen_wastage where id = ${id}
        returning id`
      return { revId: rev.id }
    })

    const [check] = await sql<{ zeroed: boolean }[]>`
      select ((select value from kitchen_wastage where id = ${id})
            + (select value from kitchen_wastage where id = ${saved.revId}) = 0) as zeroed`
    if (!check?.zeroed) throw new KitchenError('Verification failed: values do not cancel to zero')

    const [original, reversal] = await Promise.all([
      getKitchenWastageById(rid, id),
      getKitchenWastageById(rid, saved.revId),
    ])
    if (!original || !reversal || !original.is_voided) {
      throw new KitchenError('Verification failed: could not read the voided pair back')
    }
    return { ok: true, original, reversal }
  } catch (e) {
    return fail(e)
  }
}
