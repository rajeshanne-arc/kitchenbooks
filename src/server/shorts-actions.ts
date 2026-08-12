'use server'

// Write side of shorts. Two verbs, and the difference between them is the
// whole point: `saveShort` records that the vendor billed something they did
// not deliver, and `settleShort` records what happened about it afterwards.
//
// 'open' is the state that matters. A short nobody chased is a different
// fact from one that was credited, and the money is only recoverable while
// somebody is chasing it — so the settlement is a field a human answers, not
// a status the app infers from a credit note turning up.

import { z } from 'zod'
import { sql, txn } from '@/lib/db'
import { parseQty } from '@/lib/money'
import { getRestaurant } from '@/server/queries'
import {
  ShortsError,
  getShort,
  isShortKind,
  isShortSettlement,
  shortsActor,
} from '@/server/shorts-queries'
import { SHORT_KIND_LABELS } from '@/components/store/shorts'
import type { SaveShortInput, SettleShortInput, ShortResult } from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ShortsError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('shorts action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

/* ── record a short ─────────────────────────────────────────────────────── */

const SaveSchema = z.object({
  purchaseLineId: z.string().regex(UUID),
  qtyShort: z.string().trim().min(1, 'How much was short?'),
  kind: z.string().trim(),
  settlement: z.string().trim(),
  creditNoteRef: z.string().trim().max(60),
  note: z.string().trim().max(300),
})

export async function saveShort(raw: SaveShortInput): Promise<ShortResult> {
  try {
    const input = SaveSchema.parse(raw)
    const by = await shortsActor('Recording a short')

    // The kind has no natural default and the picker starts empty, so a
    // blank one is refused BY NAME rather than falling through zod's
    // generic message — the same rule as issues.session.
    const kind = input.kind
    const settlement = input.settlement
    if (!isShortKind(kind)) throw new ShortsError('Pick what happened — short, damaged or rejected')
    if (!isShortSettlement(settlement)) throw new ShortsError('Pick where this stands')
    if (settlement === 'credit_note' && input.creditNoteRef === '') {
      throw new ShortsError('A credit note needs its number — that is what you quote when it is disputed')
    }

    const qty = parseQty(input.qtyShort)
    if (qty === null || qty <= 0) throw new ShortsError('The short quantity must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const saved = await txn(async (tx) => {
      // The line must be OURS. A purchase_lines id is a uuid off the wire,
      // and this action is a public endpoint.
      const line = await tx<
        { id: string; item_name: string; is_voided: boolean; is_reversal: boolean }[]
      >`
        select pl.id, i.name as item_name, b.is_voided, b.is_reversal
        from purchase_lines pl
        join purchases p on p.id = pl.purchase_id
        join bills b on b.id = p.id
        join items i on i.id = pl.item_id
        where pl.id = ${input.purchaseLineId} and p.restaurant_id = ${rid}`
      if (!line[0]) throw new ShortsError('That bill line was not found')
      if (line[0].is_reversal) {
        throw new ShortsError('This is a reversal bill — record the short against the bill it cancels')
      }
      if (line[0].is_voided) {
        throw new ShortsError('That bill was voided — there is nothing left for the vendor to owe on it')
      }

      // Nothing here can be edited or deleted afterwards, so a double tap
      // would leave a permanent second claim in vendor_performance. A
      // second short of a DIFFERENT kind on the same line is real (part
      // missing, part damaged) and stays allowed.
      const dup = await tx<{ id: string }[]>`
        select id from purchase_line_shorts
        where purchase_line_id = ${input.purchaseLineId}
          and kind = ${kind} and settlement = 'open'`
      if (dup[0]) {
        throw new ShortsError(
          `${line[0].item_name} already has an open “${SHORT_KIND_LABELS[kind]}” on this line — settle that one instead`,
        )
      }

      const [row] = await tx<{ id: string }[]>`
        insert into purchase_line_shorts
          (restaurant_id, purchase_line_id, qty_short, kind, settlement, credit_note_ref, note, entered_by)
        values (${rid}, ${input.purchaseLineId}, ${input.qtyShort}, ${kind}, ${settlement},
                ${input.creditNoteRef === '' ? null : input.creditNoteRef},
                ${input.note === '' ? null : input.note}, ${by})
        returning id`
      if (!row) throw new ShortsError('The short was not written — nothing was saved')
      return { id: row.id }
    })

    const short = await getShort(rid, saved.id)
    if (!short) throw new ShortsError('Could not verify the save — the short is missing after commit')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/* ── settle it ──────────────────────────────────────────────────────────── */

const SettleSchema = z.object({
  id: z.string().regex(UUID),
  settlement: z.string().trim(),
  creditNoteRef: z.string().trim().max(60),
  note: z.string().trim().max(300),
})

/** The only UPDATE on this table, and it is granted on exactly these three
 *  columns — what was short, and against which line, can never be rewritten. */
export async function settleShort(raw: SettleShortInput): Promise<ShortResult> {
  try {
    const input = SettleSchema.parse(raw)
    await shortsActor('Settling a short')

    if (!isShortSettlement(input.settlement)) throw new ShortsError('Pick where this stands')
    if (input.settlement === 'credit_note' && input.creditNoteRef === '') {
      throw new ShortsError('A credit note needs its number — that is what you quote when it is disputed')
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const before = await getShort(rid, input.id)
    if (!before) throw new ShortsError('That short was not found')

    await sql`
      update purchase_line_shorts
      set settlement = ${input.settlement},
          credit_note_ref = ${input.creditNoteRef === '' ? null : input.creditNoteRef},
          note = ${input.note === '' ? null : input.note}
      where id = ${input.id} and restaurant_id = ${rid}`

    const after = await getShort(rid, input.id)
    if (!after) throw new ShortsError('Could not verify the change — the short is missing afterwards')
    if (after.settlement !== input.settlement) {
      throw new ShortsError('Could not verify the change — the settlement did not stick')
    }
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
