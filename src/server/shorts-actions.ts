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
import { tsql, txn } from '@/lib/db'
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
import type { SaveShortsInput, SaveShortsResult, SettleShortInput, ShortResult } from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ShortsError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('shorts action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

/* ── record shorts, the BILL as header ──────────────────────────────────── */
//
// One delivery shorts several lines at once. Recording that as three separate
// saves PUNISHED CHECKING A DELIVERY CAREFULLY — the receiver who counted
// every crate paid for their diligence with three trips through a form, and
// the one who waved it through paid nothing. That is exactly backwards, so
// the bill is the header and the whole delivery is one act.
//
// Errors name the ITEM, never a line number: the receiver is looking at a
// bill with names on it and has no idea which row is "line 3".

const ShortLineSchema = z.object({
  purchaseLineId: z.string().regex(UUID),
  qtyShort: z.string().trim().min(1, 'How much was short?'),
  kind: z.string().trim(),
  settlement: z.string().trim(),
  creditNoteRef: z.string().trim().max(60),
  note: z.string().trim().max(300),
})

const SaveShortsSchema = z.object({
  purchaseId: z.string().regex(UUID),
  lines: z.array(ShortLineSchema).min(1, 'Nothing to record').max(60),
})

export async function saveShorts(raw: SaveShortsInput): Promise<SaveShortsResult> {
  try {
    const input = SaveShortsSchema.parse(raw)
    const by = await shortsActor('Recording a short')

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await txn(async (tx) => {
      // The bill must be OURS and must be able to take a short at all. Checked
      // ONCE for the batch rather than per line — it is the header.
      const [bill] = await tx<{ id: string; is_voided: boolean; is_reversal: boolean }[]>`
        select p.id, b.is_voided, b.is_reversal
        from purchases p join bills b on b.id = p.id
        where p.id = ${input.purchaseId} and p.restaurant_id = ${rid}`
      if (!bill) throw new ShortsError('That bill was not found')
      if (bill.is_reversal) {
        throw new ShortsError('This is a reversal bill — record the short against the bill it cancels')
      }
      if (bill.is_voided) {
        throw new ShortsError('That bill was voided — there is nothing left for the vendor to owe on it')
      }

      // Every line must belong to THIS bill. A purchase_lines id is a uuid off
      // the wire and this action is a public endpoint, so a batch that spans
      // two bills is refused rather than quietly split.
      const owned = await tx<{ id: string; item_name: string }[]>`
        select pl.id, i.name as item_name
        from purchase_lines pl join items i on i.id = pl.item_id
        where pl.purchase_id = ${input.purchaseId}`
      const nameOf = new Map(owned.map((l) => [l.id, l.item_name]))

      const seen = new Set<string>()
      for (const l of input.lines) {
        const item = nameOf.get(l.purchaseLineId)
        if (item === undefined) throw new ShortsError('One of those lines is not on this bill')

        if (!isShortKind(l.kind)) {
          throw new ShortsError(`${item}: pick what happened — short, damaged or rejected`)
        }
        if (!isShortSettlement(l.settlement)) throw new ShortsError(`${item}: pick where this stands`)
        if (l.settlement === 'credit_note' && l.creditNoteRef === '') {
          throw new ShortsError(
            `${item}: a credit note needs its number — that is what you quote when it is disputed`,
          )
        }
        const qty = parseQty(l.qtyShort)
        if (qty === null || qty <= 0) throw new ShortsError(`${item}: the short quantity must be more than zero`)

        // Twice in ONE batch, same line and kind, is a double tap on the form.
        const fingerprint = `${l.purchaseLineId}:${l.kind}`
        if (seen.has(fingerprint)) {
          throw new ShortsError(`${item} is listed twice with the same reason — combine them into one line`)
        }
        seen.add(fingerprint)

        // Nothing here can be edited or deleted afterwards, so a repeat would
        // leave a permanent second claim in vendor_performance. A second short
        // of a DIFFERENT kind on the same line is real (part missing, part
        // damaged) and stays allowed.
        const dup = await tx<{ id: string }[]>`
          select id from purchase_line_shorts
          where purchase_line_id = ${l.purchaseLineId} and kind = ${l.kind} and settlement = 'open'`
        if (dup[0]) {
          throw new ShortsError(
            `${item} already has an open “${SHORT_KIND_LABELS[l.kind]}” on this line — settle that one instead`,
          )
        }

        const [row] = await tx<{ id: string }[]>`
          insert into purchase_line_shorts
            (restaurant_id, purchase_line_id, qty_short, kind, settlement, credit_note_ref, note, entered_by)
          values (${rid}, ${l.purchaseLineId}, ${l.qtyShort}, ${l.kind}, ${l.settlement},
                  ${l.creditNoteRef === '' ? null : l.creditNoteRef},
                  ${l.note === '' ? null : l.note}, ${by})
          returning id`
        if (!row) throw new ShortsError(`${item}: the short was not written — nothing was saved`)
      }
    })

    return { ok: true, count: input.lines.length }
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

    await tsql`
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
