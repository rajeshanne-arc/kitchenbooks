'use server'

// Write side of the kitchen truth — INSERT-only, as always.
//   Closings: VALUE per section per date; a correction is a re-file — a new
//   row that wins in kitchen_closing_current, filings visible as the
//   corrected marker. Never an edit.
//   Kitchen wastage: the VALUE is required and is what the chef states —
//   item + qty are optional detail, always as a pair. Voids are negative
//   twins copying value (and qty) EXACTLY.

import { z } from 'zod'
import type postgres from 'postgres'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getList } from '@/server/settings'
import { noteListSuggestion } from '@/server/settings-actions'
import { enteredBy } from '@/server/current-user'
import {
  getClosingCurrent,
  getClosingLines,
  getIndent,
  getIndentLines,
  getKitchenWastageById,
  getProduction,
} from '@/server/kitchen-queries'
import { decimalStringToPaise, parseMoney, parseQty } from '@/lib/money'
import type {
  IndentStatusResult,
  SaveClosingInput,
  SaveClosingResult,
  SaveIndentInput,
  SaveIndentResult,
  SaveItemizedClosingInput,
  SaveItemizedClosingResult,
  SaveKitchenWastage2Input,
  SaveKitchenWastageResult,
  SaveProductionInput,
  SaveProductionResult,
  VoidKitchenWastageResult,
  VoidProductionResult,
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
// Phase-12 law: the component is an item OR a sub/dish OR nothing. With a
// component, the cost is FROZEN server-side (qty × item_costs.issue_cost /
// recipe cost / dish cost) — the chef types a value only in value-only
// mode. Reason comes from the waste_reason list.

const qtyStr = z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'plain quantity, up to 3 decimals')

const Kw2Schema = z.object({
  date: z.string().regex(DATE_RE),
  sectionId: z.string().regex(UUID),
  reason: z.string().trim().min(1, 'A reason is required').max(60),
  note: z.string().trim().max(300),
  component: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('item'), id: z.string().regex(UUID), qty: z.string().trim() }),
    z.object({ kind: z.literal('recipe'), id: z.string().regex(UUID), qty: z.string().trim() }),
    z.object({ kind: z.literal('none'), value: z.string().trim() }),
  ]),
})

/** Frozen per-unit cost of a recipe: a sub prices at cost_per_output_unit,
 * a dish at dish_cost. Null means it cannot be costed yet — refuse loudly,
 * never freeze a silent zero. */
async function recipeUnitCost(
  tx: postgres.TransactionSql,
  rid: string,
  recipeId: string,
): Promise<{ cost: string; name: string }> {
  const rows = await tx<{ name: string; kind: string; cost: string | null }[]>`
    select r.name, r.kind,
           (case when r.kind = 'sub' then rc.cost_per_output_unit else dc.dish_cost end)::text as cost
    from recipes r
    left join recipe_costs rc on rc.recipe_id = r.id
    left join dish_costs dc on dc.recipe_id = r.id
    where r.id = ${recipeId} and r.restaurant_id = ${rid} and r.status = 'active'`
  if (!rows[0]) throw new KitchenError('Recipe not found')
  if (rows[0].cost === null) {
    throw new KitchenError(`“${rows[0].name}” cannot be costed yet — add its ingredient lines first`)
  }
  return { cost: rows[0].cost, name: rows[0].name }
}

export async function saveKitchenWastage(raw: SaveKitchenWastage2Input): Promise<SaveKitchenWastageResult> {
  try {
    const input = Kw2Schema.parse(raw)
    assertRealDate(input.date, 'Wastage date')
    if (input.component.kind !== 'none') {
      if (input.component.qty === '') throw new KitchenError('A component needs its quantity')
      const q = parseQty(input.component.qty)
      if (q === null || q <= 0) throw new KitchenError('Quantity must be a plain number more than zero')
      qtyStr.parse(input.component.qty)
    } else {
      const v = parseMoney(input.component.value)
      if (v === null || v <= 0) throw new KitchenError('Value must be more than zero — what did the loss cost?')
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    await assertKitchenSection(rid, input.sectionId)
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      let itemId: string | null = null
      let recipeId: string | null = null
      let qty: string | null = null
      let valueExpr: string // numeric text, frozen here
      if (input.component.kind === 'item') {
        const rows = await tx<{ name: string; issue_cost: string | null }[]>`
          select ic.name, ic.issue_cost::text as issue_cost
          from item_costs ic join items it on it.id = ic.item_id
          where ic.item_id = ${input.component.id} and ic.restaurant_id = ${rid} and it.status = 'active'`
        if (!rows[0]) throw new KitchenError('Item not found')
        if (rows[0].issue_cost === null) {
          throw new KitchenError(`“${rows[0].name}” has no cost on record — enter its purchase bill first`)
        }
        itemId = input.component.id
        qty = input.component.qty
        const [v] = await tx<{ v: string }[]>`
          select (${qty}::numeric * ${rows[0].issue_cost}::numeric)::text as v`
        valueExpr = v.v
      } else if (input.component.kind === 'recipe') {
        const { cost } = await recipeUnitCost(tx, rid, input.component.id)
        recipeId = input.component.id
        qty = input.component.qty
        const [v] = await tx<{ v: string }[]>`
          select (${qty}::numeric * ${cost}::numeric)::text as v`
        valueExpr = v.v
      } else {
        valueExpr = input.component.value
      }
      const [row] = await tx<{ id: string }[]>`
        insert into kitchen_wastage (restaurant_id, section_id, waste_date, item_id, recipe_id, qty, value, reason, note, entered_by)
        values (${rid}, ${input.sectionId}, ${input.date}, ${itemId}, ${recipeId}, ${qty},
                ${valueExpr}, ${input.reason}, ${input.note === '' ? null : input.note}, ${by})
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
        insert into kitchen_wastage (restaurant_id, section_id, waste_date, item_id, recipe_id, qty, value, reason, note, reverses_id, entered_by)
        select restaurant_id, section_id, waste_date, item_id, recipe_id, -qty, -value, reason, 'void', id, ${by}
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

// ------------------------------------------------------------ save indent
// The indent records what was ASKED. It never moves stock — the issue does
// that; the stamp (issues.indent_id) ties the two documents together and
// the gap between them is information, never hidden.

const IndentSchema = z.object({
  date: z.string().regex(DATE_RE),
  sectionId: z.string().regex(UUID),
  session: z.string().trim().min(1, 'Pick the session').max(40),
  note: z.string().trim().max(300),
  lines: z.array(z.object({ itemId: z.string().regex(UUID), qty: qtyStr })).min(1).max(40),
})

export async function saveIndent(raw: SaveIndentInput): Promise<SaveIndentResult> {
  try {
    const input = IndentSchema.parse(raw)
    assertRealDate(input.date, 'Indent date')
    for (const [i, l] of input.lines.entries()) {
      const q = parseQty(l.qty)
      if (q === null || q <= 0) throw new KitchenError(`Line ${i + 1}: quantity must be more than zero`)
    }
    const seen = new Set<string>()
    for (const l of input.lines) {
      if (seen.has(l.itemId)) throw new KitchenError('The same item appears twice — combine the quantities')
      seen.add(l.itemId)
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    await assertKitchenSection(rid, input.sectionId)
    const by = await enteredBy()
    const sessions = await getList(rid, 'session')
    if (!sessions.some((v) => v.toLowerCase() === input.session.toLowerCase())) {
      await noteListSuggestion(rid, 'session', input.session, by)
    }

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      for (const [i, l] of input.lines.entries()) {
        const item = await tx<{ id: string }[]>`
          select id from items where id = ${l.itemId} and restaurant_id = ${rid} and status = 'active'`
        if (!item[0]) throw new KitchenError(`Line ${i + 1}: item not found`)
      }
      const [indent] = await tx<{ id: string }[]>`
        insert into indents (restaurant_id, indent_date, section_id, session, note, entered_by)
        values (${rid}, ${input.date}, ${input.sectionId}, ${input.session},
                ${input.note === '' ? null : input.note}, ${by})
        returning id`
      const lineRows = input.lines.map((l) => ({ indent_id: indent.id, item_id: l.itemId, qty_requested: l.qty.trim() }))
      await tx`insert into indent_lines ${tx(lineRows, 'indent_id', 'item_id', 'qty_requested')}`
      return { indentId: indent.id }
    })

    const indent = await getIndent(rid, saved.indentId)
    if (!indent) throw new KitchenError('Could not verify the save — indent missing after commit')
    if (indent.line_count !== input.lines.length) {
      throw new KitchenError(`Verification failed: expected ${input.lines.length} lines, found ${indent.line_count}`)
    }
    if (indent.status !== 'open') throw new KitchenError('Verification failed: a fresh indent must be open')
    return { ok: true, indent, lines: await getIndentLines(saved.indentId) }
  } catch (e) {
    return fail(e)
  }
}

/** Cancel an OPEN indent — the only status the chef may change by hand.
 * 'issued' is stamped by the issue save; nothing ever reopens. */
export async function cancelIndent(id: string): Promise<IndentStatusResult> {
  try {
    if (!UUID.test(id)) throw new KitchenError('Malformed indent id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [row] = await tx<{ status: string }[]>`
        select status from indents where id = ${id} and restaurant_id = ${rid}`
      if (!row) throw new KitchenError('Indent not found')
      if (row.status !== 'open') throw new KitchenError(`This indent is ${row.status} — only open indents cancel`)
      await tx`update indents set status = 'cancelled' where id = ${id}`
    })
    const indent = await getIndent(rid, id)
    if (!indent || indent.status !== 'cancelled') throw new KitchenError('Verification failed: indent not cancelled')
    return { ok: true, indent }
  } catch (e) {
    return fail(e)
  }
}

// -------------------------------------------------------- save production
// Production RECORDS, it does not move inventory. unit_cost is FROZEN from
// recipe_costs.cost_per_output_unit at save; only subs are producible —
// a dish is sold, not batched.

const ProductionSchema = z.object({
  date: z.string().regex(DATE_RE),
  sectionId: z.string().regex(UUID),
  recipeId: z.string().regex(UUID),
  outputQty: qtyStr,
  note: z.string().trim().max(300),
})

export async function saveProduction(raw: SaveProductionInput): Promise<SaveProductionResult> {
  try {
    const input = ProductionSchema.parse(raw)
    assertRealDate(input.date, 'Production date')
    const q = parseQty(input.outputQty)
    if (q === null || q <= 0) throw new KitchenError('Output quantity must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    await assertKitchenSection(rid, input.sectionId)
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [recipe] = await tx<{ kind: string; name: string; cost: string | null }[]>`
        select r.kind, r.name, rc.cost_per_output_unit::text as cost
        from recipes r
        left join recipe_costs rc on rc.recipe_id = r.id
        where r.id = ${input.recipeId} and r.restaurant_id = ${rid} and r.status = 'active'`
      if (!recipe) throw new KitchenError('Recipe not found')
      if (recipe.kind !== 'sub') {
        throw new KitchenError(`“${recipe.name}” is a dish — production records batches of SUB-recipes only`)
      }
      if (recipe.cost === null) {
        throw new KitchenError(`“${recipe.name}” cannot be costed yet — add its ingredient lines first`)
      }
      const [row] = await tx<{ id: string }[]>`
        insert into productions (restaurant_id, section_id, prod_date, recipe_id, output_qty, unit_cost, note, entered_by)
        values (${rid}, ${input.sectionId}, ${input.date}, ${input.recipeId}, ${input.outputQty.trim()},
                ${recipe.cost}, ${input.note === '' ? null : input.note}, ${by})
        returning id`
      return { id: row.id }
    })

    const production = await getProduction(rid, saved.id)
    if (!production) throw new KitchenError('Could not verify the save — production missing after commit')
    return { ok: true, production }
  } catch (e) {
    return fail(e)
  }
}

export async function voidProduction(id: string): Promise<VoidProductionResult> {
  try {
    if (!UUID.test(id)) throw new KitchenError('Malformed production id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [orig] = await tx<{ id: string; reverses_id: string | null }[]>`
        select id, reverses_id from productions where id = ${id} and restaurant_id = ${rid}`
      if (!orig) throw new KitchenError('Production entry not found')
      if (orig.reverses_id !== null) throw new KitchenError('This is a reversal — reversals cannot be voided')
      const already = await tx<{ id: string }[]>`select id from productions where reverses_id = ${id} limit 1`
      if (already[0]) throw new KitchenError('This entry is already voided')
      // Negative twin: unit_cost copied EXACTLY — never re-snapshot.
      const [rev] = await tx<{ id: string }[]>`
        insert into productions (restaurant_id, section_id, prod_date, recipe_id, output_qty, unit_cost, note, reverses_id, entered_by)
        select restaurant_id, section_id, prod_date, recipe_id, -output_qty, unit_cost, 'void', id, ${by}
        from productions where id = ${id}
        returning id`
      const [check] = await tx<{ zeroed: boolean }[]>`
        select ((select value from productions where id = ${id})
              + (select value from productions where id = ${rev.id}) = 0) as zeroed`
      if (!check?.zeroed) throw new KitchenError('Verification failed: values do not cancel to zero')
      return { revId: rev.id }
    })

    const [original, reversal] = await Promise.all([getProduction(rid, id), getProduction(rid, saved.revId)])
    if (!original || !reversal || !original.is_voided) {
      throw new KitchenError('Verification failed: could not read the voided pair back')
    }
    return { ok: true, original, reversal }
  } catch (e) {
    return fail(e)
  }
}

// -------------------------------------------------- save itemized closing
// The closing is still VALUE per section — the lines are how the chef
// arrives at it. Each line freezes its unit cost at save (item issue_cost,
// sub cost_per_output_unit, dish dish_cost); the header closing_value is
// the SUM of the lines, computed in Postgres numeric so it matches the
// stored generated line values exactly. Zero lines = a zero closing, and
// zero is a real closing. Latest filing per (section, date) still wins.

const ItemizedClosingSchema = z.object({
  date: z.string().regex(DATE_RE),
  sectionId: z.string().regex(UUID),
  note: z.string().trim().max(300),
  lines: z
    .array(
      z.object({
        kind: z.enum(['item', 'sub', 'dish']),
        id: z.string().regex(UUID),
        qty: qtyStr,
      }),
    )
    .max(60),
})

export async function saveItemizedClosing(raw: SaveItemizedClosingInput): Promise<SaveItemizedClosingResult> {
  try {
    const input = ItemizedClosingSchema.parse(raw)
    assertRealDate(input.date, 'Closing date')
    for (const [i, l] of input.lines.entries()) {
      const q = parseQty(l.qty)
      if (q === null || q <= 0) throw new KitchenError(`Line ${i + 1}: quantity must be more than zero`)
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    await assertKitchenSection(rid, input.sectionId)
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      // Freeze each line's unit cost inside the transaction.
      const resolved: { item_id: string | null; recipe_id: string | null; qty: string; unit_cost: string }[] = []
      for (const [i, l] of input.lines.entries()) {
        if (l.kind === 'item') {
          const rows = await tx<{ name: string; issue_cost: string | null }[]>`
            select ic.name, ic.issue_cost::text as issue_cost
            from item_costs ic join items it on it.id = ic.item_id
            where ic.item_id = ${l.id} and ic.restaurant_id = ${rid} and it.status = 'active'`
          if (!rows[0]) throw new KitchenError(`Line ${i + 1}: item not found`)
          if (rows[0].issue_cost === null) {
            throw new KitchenError(`Line ${i + 1}: “${rows[0].name}” has no cost on record — enter its purchase bill first`)
          }
          resolved.push({ item_id: l.id, recipe_id: null, qty: l.qty.trim(), unit_cost: rows[0].issue_cost })
        } else {
          const { cost } = await recipeUnitCost(tx, rid, l.id)
          resolved.push({ item_id: null, recipe_id: l.id, qty: l.qty.trim(), unit_cost: cost })
        }
      }

      // Header value = SUM of lines, in Postgres numeric.
      const [{ total }] = await tx<{ total: string }[]>`
        select coalesce(sum(q::numeric * c::numeric), 0)::text as total
        from unnest(${resolved.map((r) => r.qty)}::text[], ${resolved.map((r) => r.unit_cost)}::text[]) as t(q, c)`

      const [closing] = await tx<{ id: string }[]>`
        insert into kitchen_closings (restaurant_id, section_id, close_date, closing_value, note, entered_by)
        values (${rid}, ${input.sectionId}, ${input.date}, ${total},
                ${input.note === '' ? null : input.note}, ${by})
        returning id`
      if (resolved.length > 0) {
        const lineRows = resolved.map((r) => ({ closing_id: closing.id, component_item_id: r.item_id, component_recipe_id: r.recipe_id, qty: r.qty, unit_cost: r.unit_cost }))
        await tx`insert into kitchen_closing_lines ${tx(lineRows, 'closing_id', 'component_item_id', 'component_recipe_id', 'qty', 'unit_cost')}`
      }

      // The header must equal the stored generated line values — inside the
      // transaction, so a mismatch rolls everything back.
      const [check] = await tx<{ matches: boolean }[]>`
        select (select closing_value from kitchen_closings where id = ${closing.id})
             = (select coalesce(sum(value), 0) from kitchen_closing_lines where closing_id = ${closing.id}) as matches`
      if (!check?.matches) throw new KitchenError('Verification failed: header value does not equal the sum of lines')
      return { closingId: closing.id }
    })

    // Read back the winning row; it must be the one just saved.
    const closing = await getClosingCurrent(rid, input.sectionId, input.date)
    if (!closing || closing.id !== saved.closingId) {
      throw new KitchenError('Verification failed: the winning closing is not the one just saved')
    }
    return { ok: true, closing, lines: await getClosingLines(saved.closingId) }
  } catch (e) {
    return fail(e)
  }
}
