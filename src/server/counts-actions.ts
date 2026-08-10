'use server'

// Write side of counts and photographs — both are FREEZES:
//   - a stock count line stores book_qty (from stock_on_hand) and unit_cost
//     (from item_costs) captured server-side inside the save transaction;
//     they are never recomputed afterwards, so the variance keeps meaning
//     even as stock moves on.
//   - a dish-cost photograph copies today's dish_costs rows verbatim; live
//     costs rewrite history, photographs don't.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getCount, getCountVariances, getIssueHistoryDays } from '@/server/counts-queries'
import { todayIST } from '@/server/store-queries'
import { parseQty } from '@/lib/money'
import type { PhotographResult, SaveCountInput, SaveCountResult } from '@/lib/types'

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

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      const [count] = await tx<{ id: string }[]>`
        insert into stock_counts (restaurant_id, count_date, note)
        values (${rid}, ${input.countDate}, ${input.note === '' ? null : input.note})
        returning id`

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
          insert into stock_count_lines (count_id, item_id, counted_qty, book_qty, unit_cost)
          values (${count.id}, ${l.itemId}, ${l.countedQty.trim()}, ${item.book_qty}, ${item.unit_cost ?? '0'})`
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
    const snapDate = todayIST()

    const inserted = await sql.begin(async (tx) => {
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
