'use server'

// METERS — the write side. Three writes, three different hands.
//
//   setMeteringMode   OWNER ONLY. It decides whether gas cost reaches the
//                     books as issued stock inside COGS or as an estimated
//                     overhead outside it. That is a decision about what a
//                     number means, and this file's rule is that only an
//                     owner makes those.
//   createMeter /     OWNER and ACCOUNTANT. The master and the rate: the
//   updateMeter       rate is the number every estimate turns on, and the
//                     accountant is who holds the real bill beside it.
//   saveMeterReading  CASHIER, MANAGER, OWNER — whoever is standing at the
//                     day close. Whoever touches the thing records it.
//
// A READING IS AN EVENT: INSERT-only, latest per (meter, date) wins in
// meter_reading_current, and a correction is a NEW ROW rather than an edit.
// kb_app holds no UPDATE on meter_readings at all, so that is enforced by
// grant and not by discipline.

import { z } from 'zod'
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { enteredBy, getSessionUser } from '@/server/current-user'
import {
  MeteringRefusal,
  assertMeterAllowed,
  getMeter,
  getMeteringMode,
  listMeters,
} from '@/server/meters-queries'
import { businessToday } from '@/server/business-day'
import { parseDecimal } from '@/lib/money'
import type { MeterKind, MeterRow, MeteringMode } from '@/lib/types'
import type { Role } from '@/lib/roles'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class MeterError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof MeterError) return { ok: false, error: e.message }
  // A refusal to double-count is not a failure — it names what is wrong and
  // what to do instead, so it reaches the user in its own words.
  if (e instanceof MeteringRefusal) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('meter action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

/** A server action is a PUBLIC ENDPOINT and the route gate is not the check.
 *  Every write below opens with one of these. */
async function actor(allowed: Role[], what: string): Promise<string> {
  const user = await getSessionUser()
  if (!user) throw new MeterError('Sign in again — the session has expired')
  if (!allowed.includes(user.role)) {
    throw new MeterError(`Only ${allowed.join(' or ')} accounts can ${what} — ask them`)
  }
  return user.username
}

/** A meter reading is a plain number with up to three decimals. NOT parseQty:
 *  that caps at five integer digits (99,999) and a digital electricity meter
 *  passes that in a couple of years, which would disable the save button with
 *  nothing on screen saying why — the parseMoney lesson, in the other
 *  direction. Nine integer digits keeps the scaled value a safe integer. */
const parseReading = (s: string): number | null => parseDecimal(s, 3, 9)

/** Rupees per unit. Four decimals because a slab rate really is quoted as
 *  8.4750, and rounding the RATE would bias every estimate the same way. */
const parseRate = (s: string): number | null => parseDecimal(s, 4, 5)

function assertRealDate(s: string, label: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new MeterError(`${label} is not a real calendar date`)
  }
}

// ───────────────────────────── the metering mode ──────────────────────────

export type MeteringModeResult = { ok: true; mode: MeteringMode } | { ok: false; error: string }

export async function setMeteringMode(raw: {
  gas: string
  electricity: string
}): Promise<MeteringModeResult> {
  try {
    await actor(['owner'], 'change how the utilities are measured')
    const input = z
      .object({ gas: z.enum(['cylinders', 'meter']), electricity: z.enum(['off', 'on']) })
      .parse(raw)

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    // SWITCHING A UTILITY OFF while one of its meters is still active would
    // leave a meter nobody may read — a form that refuses every entry, which
    // is the state that made expense_category unusable in production. Say so
    // and refuse; retiring the meter first is one tap and makes the intent
    // explicit on the record. Both directions, because the fault is symmetric
    // and only the gas half was obvious.
    const live = await listMeters(rid)
    const stranded =
      input.gas === 'cylinders'
        ? live.filter((m) => m.kind === 'gas')
        : input.electricity === 'off'
          ? live.filter((m) => m.kind === 'electricity')
          : []
    if (stranded.length > 0) {
      const utility = stranded[0].kind === 'gas' ? 'gas' : 'electricity'
      throw new MeterError(
        `Retire the ${utility} ${stranded.length === 1 ? 'meter' : 'meters'} first (${stranded
          .map((m) => m.name)
          .join(', ')}). Switching ${utility} off while one is active leaves a meter every reading is refused against — a form that looks fine and rejects everything typed into it.`,
      )
    }

    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      for (const [key, value] of [
        ['gas_measurement', input.gas],
        ['electricity_metering', input.electricity],
      ] as const) {
        await tx`
          insert into settings (restaurant_id, key, value)
          values (${rid}, ${key}, ${value})
          on conflict (restaurant_id, key) do update set value = excluded.value`
      }
    })

    // Read back. This decides where a whole utility's cost lands, and an
    // unverified save here is a silent change of meaning.
    const mode = await getMeteringMode(rid)
    if (mode.gas !== input.gas || mode.electricity !== input.electricity) {
      throw new MeterError('Could not verify the change — reload before relying on it')
    }
    return { ok: true, mode }
  } catch (e) {
    return fail(e)
  }
}

// ─────────────────────────────── the master ───────────────────────────────

export type SaveMeterInput = {
  name: string
  /** narrowed for the caller's sake only — the zod parse below is the actual
   *  gate, because a server action is a public endpoint and a TypeScript type
   *  does not exist at runtime */
  kind: MeterKind
  unit: string
  rate: string
  status: 'active' | 'inactive'
}

export type SaveMeterResult = { ok: true; meter: MeterRow } | { ok: false; error: string }

const MeterSchema = z.object({
  name: z.string().trim().min(1, 'Name the meter').max(60),
  kind: z.enum(['electricity', 'gas', 'water', 'other']),
  // Free text, NOT the `units` table — that holds bag/kg/litre, which are
  // purchase units for stock. A meter reads kWh, m³ or kL and a restaurant
  // outside this country may read something nobody here has thought of.
  unit: z.string().trim().min(1, 'What does this meter count? kWh, m³, kL…').max(20),
  rate: z.string().trim().max(20),
  status: z.enum(['active', 'inactive']),
})

function rateOrNull(raw: string): string | null {
  if (raw.trim() === '') return null
  const r = parseRate(raw)
  if (r === null || r <= 0) {
    throw new MeterError('The rate must be a plain amount per unit, more than zero — or left blank')
  }
  return (r / 10000).toFixed(4)
}

export async function createMeter(raw: SaveMeterInput): Promise<SaveMeterResult> {
  try {
    await actor(['owner', 'accountant'], 'add a meter')
    const input = MeterSchema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    // The picker only offers kinds this restaurant may use; this is the rule.
    await assertMeterAllowed(rid, input.kind)
    const rate = rateOrNull(input.rate)

    const id = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [dup] = await tx<{ id: string }[]>`
        select id from meters where restaurant_id = ${rid} and lower(name) = lower(${input.name})`
      if (dup) throw new MeterError(`There is already a meter called “${input.name}”`)
      const [row] = await tx<{ id: string }[]>`
        insert into meters (restaurant_id, name, kind, unit, assumed_rate, status)
        values (${rid}, ${input.name}, ${input.kind}, ${input.unit}, ${rate}, ${input.status})
        returning id`
      return row.id
    })

    const meter = await getMeter(rid, id)
    if (!meter) throw new MeterError('Could not verify the save — the meter is missing after commit')
    return { ok: true, meter }
  } catch (e) {
    return fail(e)
  }
}

export async function updateMeter(id: string, raw: SaveMeterInput): Promise<SaveMeterResult> {
  try {
    await actor(['owner', 'accountant'], 'edit a meter')
    if (!UUID.test(id)) throw new MeterError('Malformed meter id')
    const input = MeterSchema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const existing = await getMeter(rid, id)
    if (!existing) throw new MeterError('Meter not found — nothing was changed')
    // KIND HAS NO UPDATE GRANT and the screen says so. Every reading is filed
    // under the meter, so re-kinding an electricity meter to gas would move
    // its whole history into another utility — and past the gas refusal.
    // Retire it and open a new one. Same argument as money_accounts.kind.
    if (input.kind !== existing.kind) {
      throw new MeterError(
        'A meter cannot change what it measures — every reading it already holds belongs to that utility. Retire it and add a new one.',
      )
    }
    const rate = rateOrNull(input.rate)

    const updated = await tsql<{ id: string }[]>`
      update meters
      set name = ${input.name}, unit = ${input.unit}, assumed_rate = ${rate}, status = ${input.status}
      where id = ${id} and restaurant_id = ${rid}
      returning id`
    if (!updated[0]) throw new MeterError('Meter not found — nothing was changed')

    const meter = await getMeter(rid, id)
    if (!meter) throw new MeterError('Could not verify the change')
    return { ok: true, meter }
  } catch (e) {
    return fail(e)
  }
}

// ─────────────────────────────── a reading ────────────────────────────────

export type SaveReadingResult =
  | {
      ok: true
      meter: string
      unit: string
      reading: string
      /** null on a meter's FIRST reading — a baseline has nothing behind it */
      units: string | null
      /** whole, never divided. 2 means this figure covers two days. */
      daysSpanned: number | null
      /** null when the meter carries no rate — withheld, never zero */
      estimatedCost: string | null
      /** true when the reading is BELOW the one before it */
      wentBackwards: boolean
      previousReading: string | null
      previousDate: string | null
      /** true when this date already had a reading and this one supersedes it */
      corrected: boolean
    }
  | { ok: false; error: string }

const ReadingSchema = z.object({
  meterId: z.string().trim(),
  date: z.string().regex(DATE_RE),
  reading: z.string().trim().min(1, 'Type what the meter shows'),
  note: z.string().trim().max(300),
})

/**
 * File a reading.
 *
 * IT NEVER BLOCKS THE CASH CLOSE. This is a separate save on the same screen,
 * deliberately: the day close has a hard chain and a shortage belongs to its
 * day, and a forgotten meter must not stand between a cashier and going home.
 *
 * A READING BELOW THE PREVIOUS ONE IS ACCEPTED AND SAID LOUDLY. A five-digit
 * meter really does roll over from 99999 to 0, and a replaced meter really
 * does start again — so refusing would stop honest work, and a threshold for
 * "too big a drop" would be a magic number. What the app owes instead is to
 * never present the negative span as consumption: `meter_consumption`
 * subtracts, so the row would carry a negative `units` and a negative
 * estimated cost, and every surface renders that as "the meter went
 * backwards" rather than as a number.
 */
export async function saveMeterReading(raw: {
  meterId: string
  date: string
  reading: string
  note: string
}): Promise<SaveReadingResult> {
  try {
    await actor(['cashier', 'manager', 'owner'], 'file a meter reading')
    const input = ReadingSchema.parse(raw)
    if (!UUID.test(input.meterId)) throw new MeterError('Pick the meter first')
    assertRealDate(input.date, 'The reading date')

    const value = parseReading(input.reading)
    if (value === null || value < 0) {
      throw new MeterError('A reading is a plain number, up to three decimals, and never negative')
    }
    const readingStr = (value / 1000).toFixed(3).replace(/\.?0+$/, '') || '0'

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const meter = await getMeter(rid, input.meterId)
    if (!meter) throw new MeterError('That meter is not on this restaurant’s list')
    if (meter.status !== 'active') {
      throw new MeterError(`${meter.name} has been retired — a retired meter takes no more readings`)
    }
    // THE REFUSAL, and it is here rather than only in the picker because a
    // form can always be posted to directly and the mode can change under a
    // meter that already exists.
    await assertMeterAllowed(rid, meter.kind)

    // A reading cannot be for a day that has not happened. The business day,
    // never the calendar one — at 00:30 the calendar says tomorrow.
    const today = await businessToday()
    if (input.date > today) {
      throw new MeterError(`${input.date} has not happened yet — today is ${today}`)
    }

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [already] = await tx<{ id: string }[]>`
        select id from meter_readings
        where restaurant_id = ${rid} and meter_id = ${input.meterId} and read_date = ${input.date}::date`
      await tx`
        insert into meter_readings (restaurant_id, meter_id, read_date, reading, note, entered_by)
        values (${rid}, ${input.meterId}, ${input.date}::date, ${readingStr},
                ${input.note === '' ? null : input.note}, ${by})`
      return { corrected: already !== undefined }
    })

    // READ THE ANSWER BACK FROM THE VIEW, never echo the input. The span, the
    // units and the estimate are the view's arithmetic and this is the only
    // place they are true.
    const [row] = await tsql<{
      units: string | null
      days_spanned: number | null
      estimated_cost: string | null
      previous_reading: string | null
      previous_date: string | null
    }[]>`
      select units::text as units, days_spanned::int as days_spanned,
             estimated_cost::text as estimated_cost,
             previous_reading::text as previous_reading,
             previous_date::text as previous_date
      from meter_consumption
      where restaurant_id = ${rid} and meter_id = ${input.meterId}
        and read_date = ${input.date}::date`
    if (!row) throw new MeterError('Could not verify the save — the reading is missing after commit')

    return {
      ok: true,
      meter: meter.name,
      unit: meter.unit,
      reading: readingStr,
      units: row.units,
      daysSpanned: row.days_spanned,
      estimatedCost: row.estimated_cost,
      wentBackwards: row.units !== null && Number(row.units) < 0,
      previousReading: row.previous_reading,
      previousDate: row.previous_date,
      corrected: saved.corrected,
    }
  } catch (e) {
    return fail(e)
  }
}
