'use server'

// Write side of counts and photographs — both are FREEZES:
//   - a stock count line stores book_qty (from stock_on_hand) and unit_cost
//     (from item_costs) captured server-side inside the save transaction;
//     they are never recomputed afterwards, so the variance keeps meaning
//     even as stock moves on.
//   - a dish-cost photograph copies today's dish_costs rows verbatim; live
//     costs rewrite history, photographs don't.

import { z } from 'zod'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { enteredBy } from '@/server/current-user'
import { getCount, getCountVariances, getIssueHistoryDays } from '@/server/counts-queries'
import { parseQty } from '@/lib/money'
import type { PhotographResult, SaveCountInput, SaveCountResult } from '@/lib/types'
import { businessToday } from '@/server/business-day'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const qtyStr = z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'plain quantity, up to 3 decimals')

class CountsError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof CountsError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('counts action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

function assertRealDate(s: string, label: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new CountsError(`${label} is not a real calendar date`)
  }
  const year = Number(s.slice(0, 4))
  if (year < 2000 || year > 2100) throw new CountsError(`${label} is out of range`)
}

// --------------------------------------------------------------- save count

const CountSchema = z.object({
  /** JOIN AN EXISTING COUNT instead of starting one. Two people counting two
   *  rooms are doing ONE count, not two — a second count row would give the
   *  same night two books and two variance sets. Absent means start one. */
  countId: z.union([z.literal(''), z.string().regex(UUID)]).optional(),
  /** which room this person walked, so the sheet can say what is still to do
   *  and the lines can say who counted them */
  locationId: z.union([z.literal(''), z.string().regex(UUID)]).optional(),
  countDate: z.string().regex(DATE_RE),
  note: z.string().trim().max(300),
  lines: z.array(z.object({ itemId: z.string().regex(UUID), countedQty: qtyStr })).min(1).max(300),
})

export async function saveCount(raw: SaveCountInput): Promise<SaveCountResult> {
  try {
    const input = CountSchema.parse(raw)
    assertRealDate(input.countDate, 'Count date')
    for (const [i, l] of input.lines.entries()) {
      // zero is a real count — an empty shelf is information
      if (parseQty(l.countedQty) === null) throw new CountsError(`Line ${i + 1}: quantity must be a plain number`)
    }
    const seen = new Set<string>()
    for (const l of input.lines) {
      if (seen.has(l.itemId)) throw new CountsError('An item appears twice — count each item once')
      seen.add(l.itemId)
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      // TWO PEOPLE COUNTING TWO ROOMS ARE DOING ONE COUNT. Joining an existing
      // one rather than starting a second is the whole of shared counting: two
      // rows for one night would freeze the same book twice and produce two
      // variance sets nobody could reconcile.
      let countId: string
      if (input.countId !== undefined && input.countId !== '') {
        const [open] = await tx<{ id: string; accepted_at: string | null; count_date: string }[]>`
          select id, accepted_at::text as accepted_at, count_date::text as count_date
          from stock_counts
          where id = ${input.countId} and restaurant_id = ${rid}
          for update`
        if (!open) throw new CountsError('That count no longer exists — start a new one')
        // AN ACCEPTED COUNT IS HISTORY. Accepting writes stock_adjustments
        // against the frozen book; adding a line afterwards would put a
        // counted quantity behind a correction already made from it.
        if (open.accepted_at !== null) {
          throw new CountsError('That count has already been accepted into the book — start a new one')
        }
        countId = open.id
      } else {
        const [count] = await tx<{ id: string }[]>`
          insert into stock_counts (restaurant_id, count_date, note, entered_by)
          values (${rid}, ${input.countDate}, ${input.note === '' ? null : input.note}, ${by})
          returning id`
        countId = count.id
      }
      const count = { id: countId }

      // ALREADY COUNTED IS REFUSED BY NAME, and the name is the point: if two
      // people counted the same item, one of them is in the wrong room, and
      // "line 4 is a duplicate" does not tell either of them which. Read
      // INSIDE the transaction under the same lock, so two phones saving at
      // once cannot both pass the check.
      const already = await tx<{ item_id: string; name: string; counted_by: string | null }[]>`
        select l.item_id, i.name, l.counted_by
        from stock_count_lines l
        join items i on i.restaurant_id = l.restaurant_id and i.id = l.item_id
        where l.restaurant_id = ${rid} and l.count_id = ${countId}
          and l.item_id = any(${input.lines.map((l) => l.itemId)}::uuid[])`
      if (already.length > 0) {
        const first = already[0]
        throw new CountsError(
          `${first.name} has already been counted in this count${
            first.counted_by === null ? '' : ` by ${first.counted_by}`
          }${already.length > 1 ? `, and so have ${already.length - 1} more` : ''} — if you are both counting it, one of you is in the wrong room`,
        )
      }

      for (const [i, l] of input.lines.entries()) {
        // Freeze book_qty and unit_cost NOW, inside the transaction.
        const [item] = await tx<{ book_qty: string; unit_cost: string | null }[]>`
          select coalesce(s.on_hand_qty, 0)::text as book_qty, ic.issue_cost::text as unit_cost
          from items i
          left join stock_on_hand s on s.item_id = i.id
          left join item_costs ic on ic.item_id = i.id
          where i.id = ${l.itemId} and i.restaurant_id = ${rid} and i.status = 'active'`
        if (!item) throw new CountsError(`Line ${i + 1}: item not found`)
        await tx`
          insert into stock_count_lines (restaurant_id, count_id, item_id, counted_qty, book_qty, unit_cost, counted_by)
          values (${rid}, ${count.id}, ${l.itemId}, ${l.countedQty.trim()}, ${item.book_qty}, ${item.unit_cost ?? '0'}, ${by})`
      }
      return { countId: count.id }
    })

    const count = await getCount(rid, saved.countId)
    if (!count) throw new CountsError('Could not verify the save — count missing after commit')
    if (count.line_count !== input.lines.length) {
      throw new CountsError(`Verification failed: expected ${input.lines.length} lines, found ${count.line_count}`)
    }
    const variances = await getCountVariances(rid, saved.countId)
    const historyDays = await getIssueHistoryDays(rid)
    return { ok: true, count, variances, historyDays }
  } catch (e) {
    return fail(e)
  }
}

// ---------------------------------------------------- photograph the menu

export async function photographMenu(): Promise<PhotographResult> {
  try {
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const snapDate = await businessToday()

    const inserted = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const already = await tx<{ id: string }[]>`
        select id from dish_cost_snapshots
        where restaurant_id = ${rid} and snap_date = ${snapDate} limit 1`
      if (already[0]) {
        throw new CountsError('Today is already photographed — the photograph stands; take the next one next month-end')
      }
      const rows = await tx<{ n: number }[]>`
        with ins as (
          insert into dish_cost_snapshots
            (restaurant_id, snap_date, recipe_id, code, name, section_code, dish_cost, selling_price, food_cost_pct)
          select restaurant_id, ${snapDate}::date, recipe_id, code, name, section_code,
                 dish_cost, selling_price, food_cost_pct
          from dish_costs
          where restaurant_id = ${rid}
          returning 1
        ) select count(*)::int as n from ins`
      return rows[0].n
    })

    if (inserted === 0) throw new CountsError('No dishes to photograph — build recipes first')
    return { ok: true, snapDate, dishes: inserted }
  } catch (e) {
    return fail(e)
  }
}
