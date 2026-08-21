// METERS — the read side, and the two refusals that decide whether a meter
// may be read at all.
//
// DELIBERATELY NOT a 'use server' file. Every export from one of those is a
// public endpoint, and `assertMeterAllowed` is a guard, not an action — the
// same reason `assertAccount` lives in accounts-queries.ts rather than beside
// the forms that call it.
//
// ── GAS IS A CHOICE, NOT AN ADDITION ──────────────────────────────────────
//
// Thrayam buys gas in 19.2 kg cylinders. Measured live: GAS-001, 4 cans,
// Rs 12,100, all four still on the shelf. A cylinder is STOCK — it is bought
// on a bill, it sits in stock_on_hand, and it reaches a department's
// consumption when it is issued. Put a gas METER beside that and the same gas
// is counted twice: once as an issued can and once as an estimated rupee
// figure.
//
// So `settings.gas_measurement` is 'cylinders' or 'meter', default cylinders,
// and a gas reading is REFUSED while it says cylinders.
//
// IS THAT SETTING LEGAL? AGENTS.md forbids any setting that could make two
// restaurants' food cost percentages mean different things. This one passes,
// and the reason is narrow enough to be worth writing down: it does not let
// one restaurant CHOOSE how gas is treated, it records which of two different
// physical situations is true. A place on cylinders genuinely holds gas in
// stock; a place on a piped meter genuinely does not. The setting cannot be
// set against the plumbing without the app refusing the entries that would
// follow — which is what makes it a fact rather than an opinion.
//
// `settings.electricity_metering` is 'off' by default and readings are
// refused until it is on. That one is a capability flag: it says whether
// anybody is taking readings yet, and it changes no number's meaning.
import 'server-only'
import { tsql } from '@/lib/db'
import type {
  CylinderStockRow,
  MeterConsumptionRow,
  MeterKind,
  MeterRow,
  MeteringMode,
} from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The global category code for fuel. `categories` is a GLOBAL master shared
 *  by every tenant (see the provisioning split in AGENTS.md), so this is a
 *  structural key like dept_kind, not one restaurant's vocabulary. */
export const FUEL_CATEGORY = 'GAS'

/**
 * EVERY READ HERE NAMES ITS TENANT, and that is not belt-and-braces.
 *
 * `meters`, `meter_readings` and `attachments` shipped with RLS DISABLED —
 * see migrations/meters_attachments_rls.sql, which is written and not yet
 * applied. Tier 2 of the tenancy gate exempts a read keyed by a uuid it was
 * handed, on the grounds that RLS makes a foreign row invisible first. On
 * these tables that is false today, so `where id = $1` alone would cross the
 * tenant boundary. Nothing below relies on the key.
 */

// ─────────────────────────── the metering mode ────────────────────────────

export async function getMeteringMode(restaurantId: string): Promise<MeteringMode> {
  const rows = await tsql<{ key: string; value: string | null }[]>`
    select key, value from settings
    where restaurant_id = ${restaurantId}
      and key in ('gas_measurement', 'electricity_metering')`
  const at = (k: string) => rows.find((r) => r.key === k)?.value?.trim().toLowerCase() ?? null
  // Anything but the exact opted-in string falls back to the conservative
  // reading — the same shape as input_tax_creditable. A malformed setting
  // must never quietly switch metering on.
  return {
    gas: at('gas_measurement') === 'meter' ? 'meter' : 'cylinders',
    electricity: at('electricity_metering') === 'on' ? 'on' : 'off',
  }
}

/** Thrown when a meter of some kind may not be used here. Recognised by the
 *  actions' fail() handlers so the refusal reaches the user in its own words
 *  rather than wearing the generic "Failed — nothing was written" apology. */
export class MeteringRefusal extends Error {}

/**
 * May this restaurant record against a meter of this kind?
 *
 * Called on BOTH paths — creating a meter and saving a reading. The reading
 * one is the load-bearing check: the mode can be switched back to cylinders
 * while a gas meter already exists, and a form can always be posted to
 * directly. The picker is a courtesy; this is the rule.
 */
export async function assertMeterAllowed(restaurantId: string, kind: MeterKind): Promise<void> {
  const mode = await getMeteringMode(restaurantId)
  if (kind === 'gas' && mode.gas === 'cylinders') {
    throw new MeteringRefusal(
      'Gas is measured in cylinders here, so a gas meter reading would count the same gas twice — ' +
        'once as the can issued from the store and once as an estimate. Record the cylinder instead: ' +
        'issue it to a kitchen department on the day it is connected. An owner can change this on the ' +
        'Meters screen if the restaurant is actually on a piped supply.',
    )
  }
  if (kind === 'electricity' && mode.electricity === 'off') {
    throw new MeteringRefusal(
      'Electricity metering is switched off here, so there is nowhere for this reading to mean ' +
        'anything yet. An owner turns it on from the Meters screen.',
    )
  }
}

// ─────────────────────────────── the master ───────────────────────────────

export async function listMeters(restaurantId: string, includeRetired = false): Promise<MeterRow[]> {
  return tsql<MeterRow[]>`
    select id, name, kind, unit, assumed_rate::text as assumed_rate, status
    from meters
    where restaurant_id = ${restaurantId}
      and (${includeRetired} or status = 'active')
    order by kind asc, name asc`
}

export async function getMeter(restaurantId: string, id: string): Promise<MeterRow | null> {
  if (!UUID.test(id)) return null
  const rows = await tsql<MeterRow[]>`
    select id, name, kind, unit, assumed_rate::text as assumed_rate, status
    from meters
    where restaurant_id = ${restaurantId} and id = ${id}`
  return rows[0] ?? null
}

// ───────────────────────────── consumption ────────────────────────────────

/**
 * The readings ledger, newest first.
 *
 * NOTHING IS COALESCED. A first reading arrives with four NULLs and the
 * screen says "baseline"; a meter with no rate arrives with a NULL
 * estimated_cost and the screen says the rate has not been set. A zero in
 * either place would read as "no consumption", which is the opposite of
 * "nothing to compare it with yet".
 */
export async function getMeterConsumption(
  restaurantId: string,
  limit = 40,
): Promise<MeterConsumptionRow[]> {
  return tsql<MeterConsumptionRow[]>`
    select meter_id, name, kind, unit,
           assumed_rate::text as assumed_rate,
           read_date::text as read_date,
           reading::text as reading,
           previous_reading::text as previous_reading,
           previous_date::text as previous_date,
           units::text as units,
           days_spanned::int as days_spanned,
           estimated_cost::text as estimated_cost
    from meter_consumption
    where restaurant_id = ${restaurantId}
    order by read_date desc, name asc
    limit ${limit}`
}

/** What each meter said on one business day — the day sheet's utilities card. */
export async function getConsumptionForDate(
  restaurantId: string,
  date: string,
): Promise<MeterConsumptionRow[]> {
  return tsql<MeterConsumptionRow[]>`
    select meter_id, name, kind, unit,
           assumed_rate::text as assumed_rate,
           read_date::text as read_date,
           reading::text as reading,
           previous_reading::text as previous_reading,
           previous_date::text as previous_date,
           units::text as units,
           days_spanned::int as days_spanned,
           estimated_cost::text as estimated_cost
    from meter_consumption
    where restaurant_id = ${restaurantId} and read_date = ${date}::date
    order by kind asc, name asc`
}

export type MeterPeriodTotal = {
  meter_id: string
  name: string
  kind: MeterKind
  unit: string
  units: string | null
  estimated_cost: string | null
  days_covered: number
  readings: number
  /** readings in the window with nothing behind them — a meter's first */
  baseline_readings: number
  /** true when this meter carries no rate, so no rupee figure exists at all */
  no_rate: boolean
}

/**
 * The estimate over a span of days, per meter — what a real bill is held up
 * against at month end.
 *
 * THE SPANS ARE NOT NORMALISED. A period whose readings land on the 3rd and
 * the 19th covers whatever those readings cover; scaling that up to the
 * period's length would invent the days nobody measured, which is the same
 * fault as halving a two-day span. `days_covered` is the sum of the spans
 * actually measured, so a screen can say how much of the period it speaks for.
 */
export async function getConsumptionTotals(
  restaurantId: string,
  from: string,
  to: string,
): Promise<MeterPeriodTotal[]> {
  return tsql<MeterPeriodTotal[]>`
    select meter_id, name, kind, unit,
           -- a sum over no comparable rows stays NULL: "nothing measured" is
           -- not "measured nothing"
           sum(units) filter (where units is not null)::text as units,
           sum(estimated_cost) filter (where estimated_cost is not null)::text as estimated_cost,
           coalesce(sum(days_spanned), 0)::int as days_covered,
           count(*)::int as readings,
           count(*) filter (where previous_reading is null)::int as baseline_readings,
           bool_and(assumed_rate is null) as no_rate
    from meter_consumption
    where restaurant_id = ${restaurantId}
      and read_date >= ${from}::date and read_date <= ${to}::date
    group by meter_id, name, kind, unit
    order by kind asc, name asc`
}

/**
 * The meters a reading may actually be filed against tonight.
 *
 * DEFENCE IN DEPTH, not decoration. `setMeteringMode` refuses to switch a
 * utility off while one of its meters is still active, so this should always
 * equal the active list — but a mode row can also be edited in the database,
 * and a picker that offers a meter whose every reading the server refuses is
 * the `expense_category` failure again: a form that looks fine and rejects
 * everything typed into it.
 */
export async function listReadableMeters(restaurantId: string): Promise<MeterRow[]> {
  const [meters, mode] = await Promise.all([listMeters(restaurantId), getMeteringMode(restaurantId)])
  return meters.filter((m) =>
    m.kind === 'gas' ? mode.gas === 'meter' : m.kind === 'electricity' ? mode.electricity === 'on' : true,
  )
}

/** Active meters with no reading on a given day — the nudge beside the day
 *  close. Silent when every meter has been read, like every other badge. */
export async function getUnreadMeters(restaurantId: string, date: string): Promise<MeterRow[]> {
  return tsql<MeterRow[]>`
    select m.id, m.name, m.kind, m.unit, m.assumed_rate::text as assumed_rate, m.status
    from meters m
    where m.restaurant_id = ${restaurantId} and m.status = 'active'
      and not exists (
        select 1 from meter_readings r
        where r.restaurant_id = ${restaurantId}
          and r.meter_id = m.id and r.read_date = ${date}::date)
    order by m.kind asc, m.name asc`
}

// ──────────────────────────── gas as cylinders ────────────────────────────

/**
 * Cylinders bought, and how many of them have ever left the store.
 *
 * COMPUTED FROM THE LEDGER, NEVER ASSERTED — the same law as the first-count
 * warning. Voided bills and reversal issues are excluded on both sides, so a
 * cancelled delivery cannot inflate "purchased" and a voided issue cannot
 * make gas look consumed.
 *
 * `on_hand` comes from `stock_on_hand`, which already owns that arithmetic —
 * nothing here recomputes a figure a view publishes.
 */
export async function getCylinderStock(restaurantId: string): Promise<CylinderStockRow[]> {
  return tsql<CylinderStockRow[]>`
    select i.code, i.name, i.purchase_unit as unit,
           coalesce((
             select sum(pl.qty) from purchase_lines pl
             join purchases p on p.id = pl.purchase_id
             where pl.item_id = i.id and pl.restaurant_id = ${restaurantId}
               and p.reverses_id is null
               and not exists (select 1 from purchases v where v.reverses_id = p.id)
           ), 0)::text as purchased,
           coalesce((
             select sum(il.qty) from issue_lines il
             join issues s on s.id = il.issue_id
             where il.item_id = i.id and il.restaurant_id = ${restaurantId}
               and s.reverses_id is null
               and not exists (select 1 from issues v where v.reverses_id = s.id)
           ), 0)::text as issued,
           coalesce(soh.on_hand_qty, 0)::text as on_hand,
           soh.on_hand_value::text as on_hand_value
    from items i
    left join stock_on_hand soh
      on soh.item_id = i.id and soh.restaurant_id = ${restaurantId}
    where i.restaurant_id = ${restaurantId}
      and i.category = ${FUEL_CATEGORY}
      and i.status = 'active'
    order by i.code asc`
}
