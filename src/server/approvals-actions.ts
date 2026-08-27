'use server'

// Raising, deciding and applying a discard or a merge.
//
// APPROVED AND APPLIED ARE SEPARATE, and the schema says so with two columns
// and two statuses. Approval is a DECISION — a person read the preview and
// said yes. Application is an ACT, and an act can fail because the world moved
// between the two: a bill can land against the closing item while the request
// sits in the queue. Collapsing them would make a failure look like a refusal,
// and the owner would never learn that their yes did nothing.
//
// So `failed` is a real outcome with the database's own message on it, and it
// is NOT 'applied'. Nothing in this file writes 'applied' unless the function
// returned.

import { z } from 'zod'
import { txn, tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import {
  ApprovalRefusal,
  assertApprover,
  assertRequester,
  applyRequest,
  getApproval,
  getPreview,
  type ApprovalEntity,
  type ApprovalKind,
} from '@/server/approvals-queries'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ApprovalResult =
  | { ok: true; id: string; message: string }
  | { ok: false; error: string }

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ApprovalRefusal) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('approval action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

const RequestSchema = z.object({
  kind: z.enum(['discard', 'merge', 'reopen_period']),
  entity: z.enum(['item', 'vendor', 'period']),
  fromId: z.string().regex(UUID),
  toId: z.union([z.literal(''), z.string().regex(UUID)]).optional(),
  reason: z.string().trim().min(1).max(300),
})

export type RequestInput = z.infer<typeof RequestSchema>

/**
 * Raise a request. NEVER acts — this writes one row and stops.
 *
 * THE REASON IS REQUIRED and the form says why: the owner is being asked to
 * approve something that will leave nothing behind to explain itself. A reason
 * typed now is the only account of WHY this code was closed that anyone will
 * ever have — `approval_requests.reason` is NOT NULL for exactly that.
 *
 * The SNAPSHOT is the preview as it stood at asking, stored verbatim. It is
 * not there to be trusted at approval time — the screen re-runs the checks —
 * it is there so the two can be COMPARED. "This had 0 references when it was
 * asked and has 1 now" is a fact the owner needs and neither number alone can
 * state.
 */
export async function requestApproval(raw: RequestInput): Promise<ApprovalResult> {
  try {
    const input = RequestSchema.parse(raw)
    const by = await assertRequester()
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const toId = input.toId === undefined || input.toId === '' ? null : input.toId

    // Refused HERE as well as at approval: a request that could never be
    // applied is noise in somebody else's queue, and the person who can fix it
    // is the one standing at the form.
    const preview = await getPreview(rid, input.kind as ApprovalKind, input.entity as ApprovalEntity, input.fromId, toId)
    const blocked = preview.checks.filter((c) => !c.ok)
    if (blocked.length > 0) {
      throw new ApprovalRefusal(`${blocked[0].label}: ${blocked[0].detail}`)
    }

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      // ONE OPEN REQUEST PER ROW. Two pending merges of the same item into two
      // different survivors would both look approvable and only one could win,
      // and the loser would go to 'failed' for a reason nobody could read.
      const [open] = await tx<{ id: string; kind: string }[]>`
        select id, kind from approval_requests
        where restaurant_id = ${rid} and entity_id = ${input.fromId}
          and status in ('pending', 'approved')
        limit 1`
      if (open) {
        throw new ApprovalRefusal(
          `There is already a ${open.kind} request open on ${preview.from.code} — the owner has it`,
        )
      }
      const [row] = await tx<{ id: string }[]>`
        insert into approval_requests
          (restaurant_id, kind, entity_type, entity_id, target_entity_id, reason, snapshot, status, requested_by)
        values (${rid}, ${input.kind}, ${input.entity}, ${input.fromId}, ${toId},
                ${input.reason}, ${JSON.stringify({
                  refs: preview.refs,
                  totalRefs: preview.totalRefs,
                  cost: preview.cost,
                  checks: preview.checks,
                  fromCode: preview.from.code,
                  toCode: preview.to?.code ?? null,
                })}::jsonb, 'pending', ${by})
        returning id`
      return row.id
    })

    const what =
      input.kind === 'discard'
        ? `Discarding ${preview.from.code} — ${preview.from.name}`
        : `Merging ${preview.from.code} into ${preview.to?.code} — ${preview.totalRefs} row(s) would move`
    return { ok: true, id: saved, message: `${what}. Sent to the owner; nothing has changed yet.` }
  } catch (e) {
    return fail(e)
  }
}

const DecideSchema = z.object({
  id: z.string().regex(UUID),
  decision: z.enum(['approved', 'refused']),
  note: z.string().trim().max(300),
})

/**
 * The owner's decision, and — on yes — the act.
 *
 * THE GUARDS RUN INSIDE THE FUNCTION AND AT APPROVAL, NOT AT REQUEST. The
 * preview shown when this was raised proved nothing about today: a bill can
 * land against the closing item while the request sits in the queue, and a
 * check that passed on Tuesday has not passed on Thursday. merge_items takes
 * both rows FOR UPDATE and re-runs every check itself, which is the same
 * lesson as the purchase-order freeze re-reading its status under a lock and
 * as closePeriod re-counting its blockers inside the advisory lock.
 *
 * So this does not pre-check and then apply. It applies, and reports what the
 * database said.
 */
export async function decideApproval(raw: {
  id: string
  decision: 'approved' | 'refused'
  note: string
}): Promise<ApprovalResult> {
  try {
    const input = DecideSchema.parse(raw)
    const by = await assertApprover()
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    if (input.decision === 'refused') {
      const done = await txn(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          update approval_requests
          set status = 'refused', decided_by = ${by}, decided_at = now(),
              decision_note = ${input.note === '' ? null : input.note}
          where id = ${input.id} and restaurant_id = ${rid} and status = 'pending'
          returning id`
        return row?.id ?? null
      })
      if (done === null) throw new ApprovalRefusal('That request is no longer pending')
      return { ok: true, id: input.id, message: 'Refused. Nothing was changed.' }
    }

    const req = await getApproval(rid, input.id)
    if (!req) throw new ApprovalRefusal('That request no longer exists')
    if (req.status !== 'pending') throw new ApprovalRefusal(`That request is already ${req.status}`)

    // ─── the act ────────────────────────────────────────────────────────
    // One transaction: stamp the decision, run the function, record what it
    // returned. If the function raises, everything here rolls back and the
    // FAILURE is written in a second transaction below — because a failure
    // that rolled back with the attempt would leave no record that the owner
    // ever said yes.
    let applied: unknown = null
    let failure: string | null = null
    try {
      applied = await txn(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
        const [claimed] = await tx<{ id: string }[]>`
          update approval_requests
          set status = 'approved', decided_by = ${by}, decided_at = now(),
              decision_note = ${input.note === '' ? null : input.note}
          where id = ${input.id} and restaurant_id = ${rid} and status = 'pending'
          returning id`
        if (!claimed) throw new ApprovalRefusal('That request is no longer pending')

        // The destructive half lives in approvals-queries so a gate can call
        // it on a rolled-back transaction. Not exported from here: a function
        // that applies a request while taking the actor as a parameter must
        // not be a public endpoint.
        const result = await applyRequest(tx, rid, req, by, req.reason)

        await tx`
          update approval_requests
          set status = 'applied', applied_at = now(), applied_result = ${JSON.stringify(result)}::jsonb
          where id = ${input.id} and restaurant_id = ${rid}`
        return result
      })
    } catch (e) {
      if (e instanceof ApprovalRefusal) throw e
      failure = e instanceof Error ? e.message.slice(0, 400) : 'unknown error'
    }

    if (failure !== null) {
      // THE OWNER SEES WHY. A yes that did nothing, with no record of the yes
      // and no reason, is the worst of the three outcomes — so the decision
      // and the database's own words are written in their own transaction.
      await txn(async (tx) => {
        await tx`
          update approval_requests
          set status = 'failed', decided_by = ${by}, decided_at = now(),
              decision_note = ${input.note === '' ? null : input.note},
              applied_result = ${JSON.stringify({ error: failure })}::jsonb
          where id = ${input.id} and restaurant_id = ${rid}`
      })
      return { ok: false, error: `Approved, but it could not be applied: ${failure}` }
    }

    const r = applied as { from?: string; to?: string; moved?: Record<string, number>; discarded?: string }
    if (r.discarded !== undefined) {
      return { ok: true, id: input.id, message: `${r.discarded} is discarded. Nothing pointed at it.` }
    }
    const movedTotal = Object.values(r.moved ?? {}).reduce((a, b) => a + b, 0)
    const tables = Object.keys(r.moved ?? {}).length
    return {
      ok: true,
      id: input.id,
      message:
        movedTotal === 0
          ? `${r.from} now points at ${r.to}. Nothing had to move.`
          : `${r.from} now points at ${r.to} — ${movedTotal} row(s) moved across ${tables} table(s).`,
    }
  } catch (e) {
    return fail(e)
  }
}

/** The requester taking it back. Only while nobody has decided. */
export async function cancelApproval(id: string): Promise<ApprovalResult> {
  try {
    if (!UUID.test(id)) throw new ApprovalRefusal('Malformed request id')
    const by = await assertRequester()
    const restaurant = await getRestaurant()
    const done = await txn(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        update approval_requests set status = 'cancelled', decided_by = ${by}, decided_at = now()
        where id = ${id} and restaurant_id = ${restaurant.id} and status = 'pending'
        returning id`
      return row?.id ?? null
    })
    if (done === null) throw new ApprovalRefusal('That request is no longer pending')
    return { ok: true, id, message: 'Withdrawn. Nothing was changed.' }
  } catch (e) {
    return fail(e)
  }
}

/** Read-only, for the request form. Role-checked like every other export from
 *  a 'use server' file — this one is a public endpoint too. */
export async function previewChange(raw: {
  kind: ApprovalKind
  entity: ApprovalEntity
  fromId: string
  toId: string
}) {
  try {
    await assertRequester()
    const restaurant = await getRestaurant()
    const preview = await getPreview(
      restaurant.id,
      raw.kind,
      raw.entity,
      raw.fromId,
      raw.toId === '' ? null : raw.toId,
    )
    return { ok: true as const, preview }
  } catch (e) {
    return { ok: false as const, error: fail(e).error }
  }
}


/**
 * Candidates for a merge target. A separate search rather than `searchItems`:
 * that one is the BILL's picker and offers starter-library suggestions, which
 * are not rows and cannot be merged into. It also deliberately does NOT filter
 * to matching units — offering only compatible targets would hide the refusal
 * that teaches, and the preview is where a wrong choice should be answered.
 */
export async function searchMergeTargets(raw: { entity: ApprovalEntity; q: string; exclude: string }) {
  try {
    await assertRequester()
    const restaurant = await getRestaurant()
    const like = `%${raw.q.slice(0, 60)}%`
    const rows =
      raw.entity === 'item'
        ? await tsql<{ id: string; code: string; name: string; units: string }[]>`
            select i.id, i.code, i.name, i.purchase_unit || '/' || coalesce(i.stock_unit, '—') as units
            from items i
            where i.restaurant_id = ${restaurant.id} and i.status = 'active'
              and i.id <> ${raw.exclude}
              and (i.name ilike ${like} or i.code ilike ${like})
            order by i.code limit 12`
        : await tsql<{ id: string; code: string; name: string; units: string }[]>`
            select v.id, v.code, v.name, '' as units
            from vendors v
            where v.restaurant_id = ${restaurant.id} and v.status = 'active'
              and v.id <> ${raw.exclude}
              and (v.name ilike ${like} or v.code ilike ${like})
            order by v.code limit 12`
    return { ok: true as const, rows }
  } catch (e) {
    return { ok: false as const, error: fail(e).error, rows: [] }
  }
}


/**
 * An accountant asking for a closed month back.
 *
 * reopenPeriod() still exists and is the owner's own direct route — they would
 * otherwise be raising a request to themselves. This is the accountant's, and
 * it is a REQUEST rather than the act, because the thing a reopen destroys is
 * not in this database: the month may already have been handed to a CA, and
 * nothing here knows that. The reason is the record of why it came back.
 */
export async function requestReopen(raw: { periodCloseId: string; reason: string }): Promise<ApprovalResult> {
  try {
    if (!UUID.test(raw.periodCloseId)) throw new ApprovalRefusal('Malformed period')
    const reason = raw.reason.trim()
    if (reason === '') throw new ApprovalRefusal('Say why it needs reopening — that sentence is the record')
    return await requestApproval({
      kind: 'reopen_period',
      entity: 'period',
      fromId: raw.periodCloseId,
      toId: '',
      reason,
    })
  } catch (e) {
    return fail(e)
  }
}
