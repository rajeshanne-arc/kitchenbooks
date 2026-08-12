'use server'

// Write side of the book's corrections.
//
// THE RULE THE WHOLE FEATURE TURNS ON: ACCEPTING A VARIANCE IS A JUDGEMENT,
// NOT A CONSEQUENCE. A variance can be a counting error as easily as a stock
// error — somebody counted the back shelf twice, somebody missed a sack
// behind the door — and auto-correcting the book from a bad count would
// corrupt the very number the count exists to protect. So saveCount records
// and changes nothing; acceptCount is a separate, deliberate act by a named
// person, and it is the only thing in the app that writes stock_adjustments
// from a count.
//
// Two ways in, one table:
//   - acceptCount   — one row per non-zero variance line, reason 'Count
//                     correction', count_id set, unit_cost COPIED from the
//                     count line.
//   - saveAdjustment — a standalone correction (count_id null): opening
//                     stock, a unit error, spoilage found in a corner.
//
// stock_adjustments is an EVENT table: INSERT and SELECT only, `value` is
// GENERATED (qty × unit_cost) and must never appear in a column list.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { getList } from '@/server/settings'
import { noteListSuggestion } from '@/server/settings-actions'
import {
  AdjustmentRefusal,
  assertAdjustableItem,
  getAdjustment,
  getCountAcceptance,
} from '@/server/adjustment-queries'
import type { AcceptCountResult, AdjustmentInput, AdjustmentResult } from '@/lib/types'
import type { Role } from '@/lib/roles'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** signed, because a correction goes both ways — the shelf can hold more
 *  than the book says as easily as less */
const SIGNED_QTY = /^-?\d{1,5}(\.\d{1,3})?$/

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AdjustmentRefusal) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('adjustment action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

/**
 * Who is at the keyboard, checked against the DATABASE every time — a server
 * action is a public endpoint and the route gate is not the check.
 *
 * The store is admitted alongside manager and owner, deliberately: the
 * person who counted is the person who knows whether the shelf or the sheet
 * was wrong, and a judgement only a manager can make is a judgement that
 * waits until Monday while the book stays wrong. The control is not who may
 * press it — it is that accepted_by records who did.
 */
async function actor(allowed: Role[], what: string): Promise<string> {
  const user = await getSessionUser()
  if (!user) throw new AdjustmentRefusal('Sign in again — the session has expired')
  if (!allowed.includes(user.role)) {
    throw new AdjustmentRefusal(`${what} is the store's job — ask them, a manager or an owner`)
  }
  return user.username
}

// ─────────────────────────── accept a count into the book ─────────────────

/**
 * The judgement. One transaction: write the adjustments, stamp the count.
 *
 * unit_cost is COPIED from the count line rather than re-read from
 * item_costs. The count froze the cost at save; a rate change between the
 * count and the acceptance is a fact about today's purchases, not about what
 * the shelf was worth on the night somebody walked it with a torch. Re-
 * snapshotting would move a historical correction — the same rule as a void
 * copying its original's unit_cost exactly.
 *
 * A count with no variance is still ACCEPTED and writes nothing. It is a
 * judgement too: the book was right.
 */
export async function acceptCount(countId: string): Promise<AcceptCountResult> {
  try {
    if (!UUID.test(countId)) throw new AdjustmentRefusal('Malformed count id')
    const by = await actor(['store', 'manager', 'owner'], 'Accepting a count')
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const written = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      // Re-read inside the lock: two people on two phones both pressing
      // accept would otherwise correct the book twice for one count.
      const [count] = await tx<{ count_date: string; accepted_at: string | null; accepted_by: string | null }[]>`
        select count_date::text as count_date, accepted_at::text as accepted_at, accepted_by
        from stock_counts
        where id = ${countId} and restaurant_id = ${rid}`
      if (!count) throw new AdjustmentRefusal('That count no longer exists')
      if (count.accepted_at !== null) {
        throw new AdjustmentRefusal(
          `That count was already accepted${count.accepted_by === null ? '' : ` by ${count.accepted_by}`}` +
            ' — the book already carries it. Accepting twice would correct it twice.',
        )
      }

      // THE CORRECTION IS COMPUTED LIVE; THE VARIANCE STAYS PHOTOGRAPHED.
      //
      //   adjustment = counted − frozen book − everything already corrected
      //                for that item since this count was frozen
      //
      // A count freezes book_qty at save, and an adjustment is a DIFFERENCE
      // rather than a new total — so two counts taken while neither was
      // accepted both measure against the same uncorrected book and both
      // claim the same shortage. Book 10, shelf 7, counted twice: accept the
      // first and it writes 7−10−0 = −3, leaving 7; accept the second and it
      // writes 7−10−(−3) = 0, leaving 7. Correct in EITHER order, and a
      // standalone adjustment made in between is absorbed the same way.
      //
      // `since` is the count's own created_at, not its date: two counts on
      // one day are ordered by when they were taken, and a date cannot
      // separate them. variance_qty is untouched and still reads as what the
      // shelf disagreed with on the day — only the CORRECTION moves.
      //
      // `value` is GENERATED — absent from the column list by necessity.
      const [{ n }] = await tx<{ n: number }[]>`
        with prior as (
          -- >= rather than >, and this count's own rows excluded: created_at
          -- defaults to now(), which is the TRANSACTION timestamp and does
          -- not advance within one — so rows written together tie rather
          -- than order. Production never writes two counts in one
          -- transaction, but a rule that depends on that is a rule waiting
          -- to be wrong.
          select a.item_id, coalesce(sum(a.qty), 0) as already
          from stock_adjustments a
          join stock_counts c2 on c2.id = ${countId}
          where a.restaurant_id = ${rid}
            and a.created_at >= c2.created_at
            and a.count_id is distinct from ${countId}::uuid
          group by a.item_id
        ),
        ins as (
          insert into stock_adjustments
            (restaurant_id, adj_date, item_id, qty, unit_cost, reason, count_id, note, entered_by)
          select ${rid}::uuid, ${count.count_date}::date, l.item_id,
                 l.variance_qty - coalesce(p.already, 0), l.unit_cost,
                 'Count correction'::text, ${countId}::uuid, null, ${by}::text
          from stock_count_lines l
          left join prior p on p.item_id = l.item_id
          where l.count_id = ${countId}
            and l.variance_qty - coalesce(p.already, 0) <> 0
          returning 1
        ) select count(*)::int as n from ins`

      const [stamped] = await tx<{ id: string }[]>`
        update stock_counts
        set accepted_at = now(), accepted_by = ${by}
        where id = ${countId} and restaurant_id = ${rid} and accepted_at is null
        returning id`
      // Rolls back the adjustments too: a correction nobody is recorded as
      // having accepted is exactly what this feature exists to prevent.
      if (!stamped) throw new AdjustmentRefusal('The acceptance could not be stamped — nothing was written')

      return n
    })

    const acceptance = await getCountAcceptance(rid, countId)
    if (!acceptance || acceptance.accepted_at === null) {
      throw new AdjustmentRefusal('Could not verify the acceptance after saving')
    }
    return { ok: true, adjustments: written }
  } catch (e) {
    return fail(e)
  }
}

// ──────────────────────────── a standalone adjustment ─────────────────────

const AdjustmentSchema = z.object({
  date: z.string().regex(DATE_RE),
  itemId: z.string().regex(UUID),
  qty: z.string().trim().regex(SIGNED_QTY, 'plain quantity, up to 3 decimals, minus for a shortfall'),
  reason: z.string().trim().min(1, 'Say why the book is being corrected').max(60),
  note: z.string().trim().max(300),
})

function assertRealDate(s: string, label: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new AdjustmentRefusal(`${label} is not a real calendar date`)
  }
  const year = Number(s.slice(0, 4))
  if (year < 2000 || year > 2100) throw new AdjustmentRefusal(`${label} is out of range`)
}

/**
 * A correction with no count behind it — opening stock, a unit error caught
 * on the shelf, spoilage found in a corner. count_id stays null, which is
 * what the log reads to say where a row came from.
 *
 * The REASON is required and comes from the managed list. A typed value is
 * accepted and queued for the owner (LAW 2 as amended) — refusing the save
 * would stop the work, and the person holding the shelf cannot wait for an
 * owner to log in.
 */
export async function saveAdjustment(raw: AdjustmentInput): Promise<AdjustmentResult> {
  try {
    const input = AdjustmentSchema.parse(raw)
    assertRealDate(input.date, 'Adjustment date')
    // Zero is not a correction. Unlike a count, where 0 is a real answer,
    // an adjustment of nothing says nothing and would sit in the log
    // implying something happened.
    if (Number(input.qty) === 0) {
      throw new AdjustmentRefusal('A correction of zero corrects nothing — type the difference, minus for a shortfall')
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await actor(['store', 'manager', 'owner'], 'Correcting the book')

    const reasons = await getList(rid, 'adjustment_reason')
    if (!reasons.some((r) => r.toLowerCase() === input.reason.toLowerCase())) {
      await noteListSuggestion(rid, 'adjustment_reason', input.reason, by)
    }

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      // The cost is snapshotted server-side, full precision, inside the
      // transaction — the store never sees or types a rate on this screen,
      // exactly as on an issue.
      const item = await assertAdjustableItem(tx, rid, input.itemId)
      const [row] = await tx<{ id: string }[]>`
        insert into stock_adjustments
          (restaurant_id, adj_date, item_id, qty, unit_cost, reason, count_id, note, entered_by)
        values (${rid}, ${input.date}, ${item.id}, ${input.qty}::numeric, ${item.unitCost}::numeric,
                ${input.reason}, null, ${input.note === '' ? null : input.note}, ${by})
        returning id`
      if (!row) throw new AdjustmentRefusal('The adjustment could not be saved')
      return row.id
    })

    const adjustment = await getAdjustment(rid, saved)
    if (!adjustment) throw new AdjustmentRefusal('Could not verify the save — the adjustment is missing after commit')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
