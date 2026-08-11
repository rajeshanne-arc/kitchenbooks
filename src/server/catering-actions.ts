'use server'

// Catering write side. The event carries what was COLLECTED; its cost is
// never typed — it accumulates from the issues stamped to it and its own
// expenses, and catering_summary does the arithmetic.
//
// There is deliberately no menu price anywhere: a catering job is costed
// from what actually left the store.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { enteredBy } from '@/server/current-user'
import { getList } from '@/server/settings'
import { noteListSuggestion } from '@/server/settings-actions'
import { getCateringEvent, listCateringEvents } from '@/server/catering-queries'
import { parseMoney } from '@/lib/money'
import type {
  SaveCateringEventInput,
  SaveCateringEventResult,
  SaveCateringExpenseInput,
} from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const moneyStr = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'plain amount, up to 2 decimals')

class CateringError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof CateringError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('catering action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

const EventSchema = z.object({
  date: z.string().regex(DATE_RE),
  name: z.string().trim().min(1, 'Name the event').max(120),
  customer: z.string().trim().max(120),
  contact: z.string().trim().max(60),
  covers: z.union([z.literal(''), z.string().regex(/^\d{1,5}$/)]),
  revenueCollected: z.union([z.literal(''), moneyStr]),
  paymentMode: z.string().trim().max(30),
  note: z.string().trim().max(300),
})

export async function saveCateringEvent(raw: SaveCateringEventInput): Promise<SaveCateringEventResult> {
  try {
    const input = EventSchema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    if (input.paymentMode !== '') {
      const modes = await getList(rid, 'payment_mode')
      if (!modes.some((m) => m.toLowerCase() === input.paymentMode.toLowerCase())) {
        await noteListSuggestion(rid, 'payment_mode', input.paymentMode, by)
      }
    }

    const [row] = await sql<{ id: string }[]>`
      insert into catering_events (restaurant_id, event_date, name, customer, contact, covers,
                                   revenue_collected, payment_mode, note, entered_by)
      values (${rid}, ${input.date}, ${input.name},
              ${input.customer === '' ? null : input.customer},
              ${input.contact === '' ? null : input.contact},
              ${input.covers === '' ? null : Number(input.covers)},
              ${input.revenueCollected === '' ? '0' : input.revenueCollected}::numeric,
              ${input.paymentMode === '' ? null : input.paymentMode},
              ${input.note === '' ? null : input.note}, ${by})
      returning id`

    const events = await listCateringEvents(rid)
    const event = events.find((e) => e.catering_id === row.id)
    if (!event) throw new CateringError('Could not verify the save — event missing after commit')
    return { ok: true, event }
  } catch (e) {
    return fail(e)
  }
}

/** Revenue collected is the one figure that arrives after the event, so it
 *  is the one thing editable. Cost is never editable — it is the issues. */
export async function updateCateringRevenue(
  id: string,
  revenueCollected: string,
  paymentMode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!UUID.test(id)) throw new CateringError('Malformed event id')
    if (revenueCollected !== '' && parseMoney(revenueCollected) === null) {
      throw new CateringError('Revenue must be a plain amount')
    }
    const restaurant = await getRestaurant()
    const updated = await sql<{ id: string }[]>`
      update catering_events set
        revenue_collected = ${revenueCollected === '' ? '0' : revenueCollected}::numeric,
        payment_mode = ${paymentMode === '' ? null : paymentMode}
      where id = ${id} and restaurant_id = ${restaurant.id}
      returning id`
    if (!updated[0]) throw new CateringError('Event not found — nothing was changed')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

const ExpenseSchema = z.object({
  cateringId: z.string().regex(UUID),
  description: z.string().trim().max(200),
  amount: moneyStr,
  paidVia: z.string().trim().max(30),
})

export async function addCateringExpense(
  raw: SaveCateringExpenseInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = ExpenseSchema.parse(raw)
    const amount = parseMoney(input.amount)
    if (amount === null || amount <= 0) throw new CateringError('Amount must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const event = await getCateringEvent(rid, input.cateringId)
    if (!event) throw new CateringError('That event does not exist')

    await sql`
      insert into catering_expenses (catering_id, description, amount, paid_via)
      values (${input.cateringId}, ${input.description === '' ? null : input.description},
              ${input.amount}, ${input.paidVia === '' ? null : input.paidVia})`
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
