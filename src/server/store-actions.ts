'use server'

// Write side of the consumption spine, as the kb_app role (INSERT-only on
// events — the database refuses anything else).
//
// The cost rule: unit_cost is snapshotted from item_costs.issue_cost at save
// time, server-side, full precision — the store manager never sees or types
// a cost. Voids are negative twins that copy each original line's unit_cost
// EXACTLY; they never re-snapshot, so a rate change between entry and void
// can never leave a residue in section_consumption or stock_on_hand.

import { z } from 'zod'
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { enteredBy } from '@/server/current-user'
import {
  getIssue,
  getIssueLines,
  getReturn,
  getReturnLines,
  getStockSnaps,
  getWastage,
} from '@/server/store-queries'
import { getList } from '@/server/settings'
import { noteListSuggestion } from '@/server/settings-actions'
import { parseQty } from '@/lib/money'
import type {
  SaveIssueInput,
  SaveIssueResult,
  SaveReturnInput,
  SaveReturnResult,
  SaveStoreLossesInput,
  SaveStoreLossesResult,
  SaveWastageInput,
  WastageDetail,
  SaveWastageResult,
  VoidIssueResult,
  VoidWastageResult,
} from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const qtyStr = z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'plain quantity, up to 3 decimals')

class StoreError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof StoreError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('store action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

function assertRealDate(s: string, label: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new StoreError(`${label} is not a real calendar date`)
  }
  const year = Number(s.slice(0, 4))
  if (year < 2000 || year > 2100) throw new StoreError(`${label} is out of range`)
}

// -------------------------------------------------------------- save issue

const IssueSchema = z.object({
  issueDate: z.string().regex(DATE_RE),
  sectionId: z.string().regex(UUID),
  // No default and no fallback. issues.session defaults to 'Morning' in the
  // database, and a silent default is how every issue came to claim it was
  // a morning issue. An unanswered question is refused, not guessed.
  session: z.string().trim().min(1, 'Pick the session — morning, evening or extra'),
  lines: z
    .array(z.object({ itemId: z.string().regex(UUID), qty: qtyStr, note: z.string().trim().max(200) }))
    .min(1)
    .max(40),
  indentId: z.string().regex(UUID).optional(),
  cateringId: z.string().regex(UUID).optional(),
})

export async function saveIssue(raw: SaveIssueInput): Promise<SaveIssueResult> {
  try {
    const input = IssueSchema.parse(raw)
    assertRealDate(input.issueDate, 'Issue date')
    for (const [i, l] of input.lines.entries()) {
      const q = parseQty(l.qty)
      if (q === null || q <= 0) throw new StoreError(`Line ${i + 1}: quantity must be more than zero`)
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()
    const sessions = await getList(rid, 'session')
    if (!sessions.some((v) => v.toLowerCase() === input.session.toLowerCase())) {
      await noteListSuggestion(rid, 'session', input.session, by)
    }

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      // THE PICKER IS NOT THE CHECK. The form offers only departments that
      // receive stock; this refuses the rest whatever was posted. Store,
      // Accounts, Valet and Security consume nothing the store holds — and
      // the store issuing to itself is not a movement at all. A return is
      // guarded the same way: stock cannot come back from a department it
      // could never have gone to.
      const section = await tx<{ id: string; name: string; receives_stock: boolean }[]>`
        select id, name, receives_stock from sections
        where id = ${input.sectionId} and restaurant_id = ${rid} and status = 'active'`
      if (!section[0]) throw new StoreError('Section not found')
      if (!section[0].receives_stock) {
        throw new StoreError(`${section[0].name} does not receive stock — pick a department that does`)
      }

      // Answering an indent: the stamp ties ASKED to GIVEN, and the indent
      // moves to 'issued'. Section mismatch is refused, not silently fixed.
      if (input.indentId !== undefined) {
        const [indent] = await tx<{ status: string; section_id: string; section_name: string }[]>`
          select i.status, i.section_id, s.name as section_name
          from indents i join sections s on s.id = i.section_id
          where i.id = ${input.indentId} and i.restaurant_id = ${rid}`
        if (!indent) throw new StoreError('That indent no longer exists')
        if (indent.status !== 'open') throw new StoreError(`That indent is already ${indent.status}`)
        if (indent.section_id !== input.sectionId) {
          throw new StoreError(`That indent belongs to ${indent.section_name} — issue to that section, or drop the indent`)
        }
        await tx`update indents set status = 'issued'
                 where id = ${input.indentId} and restaurant_id = ${rid}`
      }

      // Snapshot each item's cost from item_costs inside the transaction.
      const costs = new Map<string, string>()
      for (const [i, l] of input.lines.entries()) {
        if (costs.has(l.itemId)) continue
        const rows = await tx<{ name: string; issue_cost: string | null }[]>`
          select ic.name, ic.issue_cost::text as issue_cost
          from item_costs ic
          join items it on it.id = ic.item_id
          where ic.item_id = ${l.itemId} and ic.restaurant_id = ${rid} and it.status = 'active'`
        if (!rows[0]) throw new StoreError(`Line ${i + 1}: item not found`)
        if (rows[0].issue_cost === null) {
          throw new StoreError(`“${rows[0].name}” has no cost on record — enter its purchase bill first`)
        }
        costs.set(l.itemId, rows[0].issue_cost)
      }

      const [issue] = await tx<{ id: string }[]>`
        insert into issues (restaurant_id, issue_date, section_id, session, indent_id,
                            catering_id, entered_by)
        values (${rid}, ${input.issueDate}, ${input.sectionId}, ${input.session},
                ${input.indentId ?? null}, ${input.cateringId ?? null}, ${by})
        returning id`

      const lineRows = input.lines.map((l) => ({
        restaurant_id: rid,
        issue_id: issue.id,
        item_id: l.itemId,
        qty: l.qty.trim(),
        unit_cost: costs.get(l.itemId)!,
        note: l.note === '' ? null : l.note,
      }))
      await tx`insert into issue_lines ${tx(lineRows, 'restaurant_id', 'issue_id', 'item_id', 'qty', 'unit_cost', 'note')}`
      return { issueId: issue.id }
    })

    const issue = await getIssue(rid, saved.issueId)
    if (!issue) throw new StoreError('Could not verify the save — issue missing after commit')
    if (issue.line_count !== input.lines.length) {
      throw new StoreError(`Verification failed: expected ${input.lines.length} lines, found ${issue.line_count}`)
    }
    if (input.indentId !== undefined) {
      if (issue.indent_id !== input.indentId) throw new StoreError('Verification failed: indent stamp missing on the issue')
      const [ind] = await tsql<{ status: string }[]>`select status from indents where id = ${input.indentId}`
      if (ind?.status !== 'issued') throw new StoreError('Verification failed: indent not marked issued')
    }
    const lines = await getIssueLines(saved.issueId)
    const stock = await getStockSnaps(rid, [...new Set(input.lines.map((l) => l.itemId))])
    return { ok: true, issue, lines, stock }
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------------------- save return
//
// The same movement as an issue, with the sign of reality reversed: stock the
// section did not use coming back to the store. It is NOT a void — the issue
// really happened, and pretending otherwise would erase the trip.
//
// unit_cost is snapshotted from item_costs.issue_cost exactly as an issue is.
// section_consumption computes issued − returned, so both sides must be
// valued on the same scale or the subtraction would be meaningless.

const ReturnSchema = z.object({
  returnDate: z.string().regex(DATE_RE),
  sectionId: z.string().regex(UUID),
  session: z.string().trim().min(1, 'Pick the session'),
  reason: z.string().trim().min(1, 'Pick a reason').max(60),
  lines: z
    .array(z.object({ itemId: z.string().regex(UUID), qty: qtyStr, note: z.string().trim().max(200) }))
    .min(1)
    .max(40),
})

export async function saveReturn(raw: SaveReturnInput): Promise<SaveReturnResult> {
  try {
    const input = ReturnSchema.parse(raw)
    assertRealDate(input.returnDate, 'Return date')
    for (const [i, l] of input.lines.entries()) {
      const q = parseQty(l.qty)
      if (q === null || q <= 0) throw new StoreError(`Line ${i + 1}: quantity must be more than zero`)
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()
    const reasons = await getList(rid, 'return_reason')
    if (!reasons.some((r) => r.toLowerCase() === input.reason.toLowerCase())) {
      await noteListSuggestion(rid, 'return_reason', input.reason, by)
    }

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      // THE PICKER IS NOT THE CHECK. The form offers only departments that
      // receive stock; this refuses the rest whatever was posted. Store,
      // Accounts, Valet and Security consume nothing the store holds — and
      // the store issuing to itself is not a movement at all. A return is
      // guarded the same way: stock cannot come back from a department it
      // could never have gone to.
      const section = await tx<{ id: string; name: string; receives_stock: boolean }[]>`
        select id, name, receives_stock from sections
        where id = ${input.sectionId} and restaurant_id = ${rid} and status = 'active'`
      if (!section[0]) throw new StoreError('Section not found')
      if (!section[0].receives_stock) {
        throw new StoreError(`${section[0].name} does not receive stock — pick a department that does`)
      }

      const costs = new Map<string, string>()
      for (const [i, l] of input.lines.entries()) {
        if (costs.has(l.itemId)) continue
        const rows = await tx<{ name: string; issue_cost: string | null }[]>`
          select ic.name, ic.issue_cost::text as issue_cost
          from item_costs ic
          join items it on it.id = ic.item_id
          where ic.item_id = ${l.itemId} and ic.restaurant_id = ${rid} and it.status = 'active'`
        if (!rows[0]) throw new StoreError(`Line ${i + 1}: item not found`)
        if (rows[0].issue_cost === null) {
          throw new StoreError(`“${rows[0].name}” has no cost on record — enter its purchase bill first`)
        }
        costs.set(l.itemId, rows[0].issue_cost)
      }

      const [ret] = await tx<{ id: string }[]>`
        insert into returns (restaurant_id, return_date, section_id, reason, entered_by)
        values (${rid}, ${input.returnDate}, ${input.sectionId}, ${input.reason}, ${by})
        returning id`

      const lineRows = input.lines.map((l) => ({
        restaurant_id: rid,
        return_id: ret.id,
        item_id: l.itemId,
        qty: l.qty.trim(),
        unit_cost: costs.get(l.itemId)!,
        note: l.note === '' ? null : l.note,
      }))
      await tx`insert into return_lines ${tx(lineRows, 'restaurant_id', 'return_id', 'item_id', 'qty', 'unit_cost', 'note')}`
      return { returnId: ret.id }
    })

    const ret = await getReturn(rid, saved.returnId)
    if (!ret) throw new StoreError('Could not verify the save — return missing after commit')
    if (ret.line_count !== input.lines.length) {
      throw new StoreError(`Verification failed: expected ${input.lines.length} lines, found ${ret.line_count}`)
    }
    const lines = await getReturnLines(saved.returnId)
    const stock = await getStockSnaps(rid, [...new Set(input.lines.map((l) => l.itemId))])
    return { ok: true, ret, lines, stock }
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------------------ save wastage

const WastageSchema = z.object({
  wasteDate: z.string().regex(DATE_RE),
  itemId: z.string().regex(UUID),
  qty: qtyStr,
  reason: z.string().trim().min(1).max(60),
  note: z.string().trim().max(300),
})

export async function saveWastage(raw: SaveWastageInput): Promise<SaveWastageResult> {
  try {
    const input = WastageSchema.parse(raw)
    assertRealDate(input.wasteDate, 'Wastage date')
    const q = parseQty(input.qty)
    if (q === null || q <= 0) throw new StoreError('Quantity must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const rows = await tx<{ name: string; issue_cost: string | null }[]>`
        select ic.name, ic.issue_cost::text as issue_cost
        from item_costs ic
        join items it on it.id = ic.item_id
        where ic.item_id = ${input.itemId} and ic.restaurant_id = ${rid} and it.status = 'active'`
      if (!rows[0]) throw new StoreError('Item not found')
      if (rows[0].issue_cost === null) {
        throw new StoreError(`“${rows[0].name}” has no cost on record — enter its purchase bill first`)
      }
      const [w] = await tx<{ id: string }[]>`
        insert into wastage (restaurant_id, waste_date, item_id, qty, unit_cost, reason, note, entered_by)
        values (${rid}, ${input.wasteDate}, ${input.itemId}, ${input.qty.trim()}, ${rows[0].issue_cost},
                ${input.reason}, ${input.note === '' ? null : input.note}, ${by})
        returning id`
      return { wastageId: w.id }
    })

    const wastage = await getWastage(rid, saved.wastageId)
    if (!wastage) throw new StoreError('Could not verify the save — wastage row missing after commit')
    const [stock] = await getStockSnaps(rid, [input.itemId])
    return { ok: true, wastage, stock }
  } catch (e) {
    return fail(e)
  }
}

// --------------------------------------------- store losses, header + lines
//
// The closing form's shape. One header (date), N lines, one save — every
// `wastage` row already carries its own date, so a batch is N ordinary rows
// and nothing about how they are read changes.
//
// REASON IS PER LINE. Spoilage and breakage happen in the same bin on the
// same day for different reasons, and the reason is what makes the waste
// report worth reading. Cost stays attached automatically: unit_cost is
// frozen from item_costs.issue_cost at save and `value` is GENERATED, so the
// store manager types a quantity and never a rupee.

const StoreLossesSchema = z.object({
  date: z.string().regex(DATE_RE),
  note: z.string().trim().max(300),
  lines: z
    .array(
      z.object({
        itemId: z.string().regex(UUID),
        qty: z.string().trim(),
        reason: z.string().trim().min(1, 'Every line needs a reason').max(60),
        note: z.string().trim().max(200),
      }),
    )
    .min(1, 'A loss needs at least one line')
    .max(60),
})

export async function saveStoreLosses(raw: SaveStoreLossesInput): Promise<SaveStoreLossesResult> {
  try {
    const input = StoreLossesSchema.parse(raw)
    assertRealDate(input.date, 'Wastage date')
    input.lines.forEach((l, i) => {
      const q = parseQty(l.qty)
      if (q === null || q <= 0) throw new StoreError(`Line ${i + 1}: quantity must be more than zero`)
    })

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const ids: string[] = []
      for (const [i, l] of input.lines.entries()) {
        const rows = await tx<{ name: string; issue_cost: string | null }[]>`
          select ic.name, ic.issue_cost::text as issue_cost
          from item_costs ic join items it on it.id = ic.item_id
          where ic.item_id = ${l.itemId} and ic.restaurant_id = ${rid} and it.status = 'active'`
        if (!rows[0]) throw new StoreError(`Line ${i + 1}: item not found`)
        if (rows[0].issue_cost === null) {
          throw new StoreError(
            `Line ${i + 1}: “${rows[0].name}” has no cost on record — enter its purchase bill first`,
          )
        }
        // The line's own note wins; the header note is the fallback, so a
        // shared explanation does not have to be typed on every row.
        const note = l.note !== '' ? l.note : input.note
        const [w] = await tx<{ id: string }[]>`
          insert into wastage (restaurant_id, waste_date, item_id, qty, unit_cost, reason, note, entered_by)
          values (${rid}, ${input.date}, ${l.itemId}, ${l.qty.trim()}, ${rows[0].issue_cost},
                  ${l.reason}, ${note === '' ? null : note}, ${by})
          returning id`
        ids.push(w.id)
      }
      return ids
    })

    const rows: WastageDetail[] = []
    for (const id of saved) {
      const w = await getWastage(rid, id)
      if (!w) throw new StoreError('Could not verify the save — a wastage row is missing after commit')
      rows.push(w)
    }
    const stock = await getStockSnaps(rid, [...new Set(input.lines.map((l) => l.itemId))])
    const total = rows.reduce((n, r) => n + Number(r.value), 0).toFixed(2)
    return { ok: true, rows, stock, total }
  } catch (e) {
    return fail(e)
  }
}

// -------------------------------------------------------------- void issue

export async function voidIssue(issueId: string): Promise<VoidIssueResult> {
  try {
    if (!UUID.test(issueId)) throw new StoreError('Malformed issue id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [orig] = await tx<
        { id: string; issue_date: string; section_id: string; reverses_id: string | null }[]
      >`
        select id, issue_date::text as issue_date, section_id, reverses_id
        from issues where id = ${issueId} and restaurant_id = ${rid}`
      if (!orig) throw new StoreError('Issue not found')
      if (orig.reverses_id !== null) throw new StoreError('This is a reversal — reversals cannot be voided')
      const already = await tx<{ id: string }[]>`select id from issues where reverses_id = ${issueId} limit 1`
      if (already[0]) throw new StoreError('This issue is already voided')
      const [{ n: lineCount }] = await tx<{ n: number }[]>`
        select count(*)::int as n from issue_lines where issue_id = ${issueId}`

      const [rev] = await tx<{ id: string }[]>`
        insert into issues (restaurant_id, issue_date, section_id, reverses_id, entered_by)
        select restaurant_id, issue_date, section_id, id, ${by}
        from issues where id = ${issueId}
        returning id`
      // Copy each original line's unit_cost EXACTLY — never re-snapshot.
      await tx`
        insert into issue_lines (restaurant_id, issue_id, item_id, qty, unit_cost)
        select restaurant_id, ${rev.id}, item_id, -qty, unit_cost
        from issue_lines where issue_id = ${issueId}`
      return { revId: rev.id, issueDate: orig.issue_date, sectionId: orig.section_id, expectedLines: lineCount }
    })

    const [check] = await tsql<{ zeroed: boolean; rev_lines: number }[]>`
      select ((select coalesce(sum(value), 0) from issue_lines where issue_id = ${issueId})
            + (select coalesce(sum(value), 0) from issue_lines where issue_id = ${saved.revId}) = 0) as zeroed,
             (select count(*)::int from issue_lines where issue_id = ${saved.revId}) as rev_lines`
    if (!check?.zeroed) throw new StoreError('Verification failed: issue values do not cancel to zero')
    if (check.rev_lines !== saved.expectedLines) {
      throw new StoreError(`Verification failed: expected ${saved.expectedLines} reversal lines, found ${check.rev_lines}`)
    }

    const [original, reversal] = await Promise.all([getIssue(rid, issueId), getIssue(rid, saved.revId)])
    if (!original || !reversal || !original.is_voided) {
      throw new StoreError('Verification failed: could not read the voided pair back')
    }
    const lineItems = await getIssueLines(issueId)
    const stock = await getStockSnaps(rid, [...new Set(lineItems.map((l) => l.item_id))])
    const monthStart = `${saved.issueDate.slice(0, 7)}-01`
    const mv = await tsql<{ v: string }[]>`
      select coalesce(sc.consumed_value, 0)::text as v
      from sections s
      left join section_consumption sc
        on sc.restaurant_id = s.restaurant_id and sc.section_code = s.code and sc.month = ${monthStart}::date
      where s.id = ${saved.sectionId}`
    return { ok: true, original, reversal, stock, monthValue: mv[0]?.v ?? '0' }
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------------------ void wastage

export async function voidWastage(wastageId: string): Promise<VoidWastageResult> {
  try {
    if (!UUID.test(wastageId)) throw new StoreError('Malformed wastage id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [orig] = await tx<{ id: string; item_id: string; reverses_id: string | null }[]>`
        select id, item_id, reverses_id from wastage where id = ${wastageId} and restaurant_id = ${rid}`
      if (!orig) throw new StoreError('Wastage entry not found')
      if (orig.reverses_id !== null) throw new StoreError('This is a reversal — reversals cannot be voided')
      const already = await tx<{ id: string }[]>`select id from wastage where reverses_id = ${wastageId} limit 1`
      if (already[0]) throw new StoreError('This wastage entry is already voided')

      // Negative twin with the original's unit_cost copied exactly.
      const [rev] = await tx<{ id: string }[]>`
        insert into wastage (restaurant_id, waste_date, item_id, qty, unit_cost, reason, note, reverses_id, entered_by)
        select restaurant_id, waste_date, item_id, -qty, unit_cost, reason, 'void', id, ${by}
        from wastage where id = ${wastageId}
        returning id`
      return { revId: rev.id, itemId: orig.item_id }
    })

    const [check] = await tsql<{ zeroed: boolean }[]>`
      select ((select value from wastage where id = ${wastageId})
            + (select value from wastage where id = ${saved.revId}) = 0) as zeroed`
    if (!check?.zeroed) throw new StoreError('Verification failed: wastage values do not cancel to zero')

    const [original, reversal] = await Promise.all([getWastage(rid, wastageId), getWastage(rid, saved.revId)])
    if (!original || !reversal || !original.is_voided) {
      throw new StoreError('Verification failed: could not read the voided pair back')
    }
    const [stock] = await getStockSnaps(rid, [saved.itemId])
    return { ok: true, original, reversal, stock }
  } catch (e) {
    return fail(e)
  }
}
