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
  recordAct,
  assertPayableRange,
  assertStillPayable,
  assertAmountStillCovered,
  assertAssignee,
  assertPayer,
  PAYERS,
  SEND_BACK,
  MASTER_SUBJECTS,
  assertWithdrawable,
  getVendorStanding,
  roleOfRequester,
  type ApprovalEntity,
  type ApprovalKind,
} from '@/server/approvals-queries'

import { AccountRefusal, assertAccount, getAccountBalances } from '@/server/accounts-queries'
import { getSessionUser } from '@/server/current-user'
import { formatMoneyString } from '@/lib/money'
import { withdrawnMessage } from '@/lib/waiting'
import { insertPayment } from '@/server/payment-write'
import { getVendorAging, listBillsOutstanding } from '@/server/aging-queries'
import type { DateRange } from '@/lib/bill-range'
import { fmtRange } from '@/lib/format'
import type { BillOutstandingRow } from '@/lib/types'
import { decimalStringToPaise, formatPaise, parseMoney } from '@/lib/money'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ApprovalResult =
  | { ok: true; id: string; message: string }
  | { ok: false; error: string }

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ApprovalRefusal) return { ok: false, error: e.message }
  // The fifth fail() handler to recognise it. An account refusal names what is
  // missing and where to create it; wearing the generic apology instead would
  // leave somebody with no next step, which is the state that reads as the app
  // being broken.
  if (e instanceof AccountRefusal) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('approval action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

const RequestSchema = z.object({
  kind: z.enum(['discard', 'merge', 'reopen_period']),
  // READ FROM THE REGISTRY, never listed again here: the screen offering
  // the control and the server accepting it must agree about which rows
  // can be closed, and two hand-written lists is how they stop agreeing.
  entity: z.enum(MASTER_SUBJECTS),
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
      // ::text::jsonb, AND THE ::text IS NOT DECORATION. postgres.js infers a
      // parameter's type from the cast it is going into, so a JS STRING
      // heading for ::jsonb is JSON-ENCODED AGAIN — `{"a":1}` became the jsonb
      // STRING `"{\"a\":1}"`, and every read of it came back as text that no
      // `.field` access could touch. Silent: the column is populated, the
      // shape is valid jsonb, and every consumer reads undefined.
      //
      // Casting through ::text first removes the inference, exactly as it did
      // for `at time zone` — a parameter's inferred type can change the
      // MEANING of the value, not only its formatting.
      //
      // 10 columns, 10 values. `assigned_to` is the one that is easy to leave
      // off and impossible to notice: `awaiting_me` filters it NOT NULL, so a
      // request that never names a role is a request no badge can ever see —
      // the view was live with nothing writing the column it keys on.
      const [row] = await tx<{ id: string }[]>`
        insert into approval_requests
          (restaurant_id, kind, entity_type, entity_id, target_entity_id, reason, snapshot, status,
           assigned_to, requested_by)
        values (${rid}, ${input.kind}, ${input.entity}, ${input.fromId}, ${toId},
                ${input.reason}, ${JSON.stringify({
                  refs: preview.refs,
                  totalRefs: preview.totalRefs,
                  cost: preview.cost,
                  checks: preview.checks,
                  fromCode: preview.from.code,
                  toCode: preview.to?.code ?? null,
                })}::text::jsonb, 'pending',
                'owner', ${by})
        returning id`

      // THE TRAIL HAS NO HOLE AT ITS OWN START. Nothing but this event records
      // who raised it; `requested_by` survives but the ACT of raising does
      // not, and no later event implies it. Written on the same handle as the
      // row, so a request can never exist without it.
      await tx`
        insert into approval_events (restaurant_id, request_id, action, note, acted_by)
        values (${rid}, ${row.id}, 'raised', ${input.reason}, ${by})`
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

    const req = await getApproval(rid, input.id)
    if (!req) throw new ApprovalRefusal('That request no longer exists')
    // A CHALLENGE COMES BACK FOR A DECISION, a return does not. Somebody who
    // objected to the payment itself has put the question back to the owner,
    // so `challenged` is decidable exactly as `pending` is.
    if (req.status !== 'pending' && req.status !== 'challenged') {
      throw new ApprovalRefusal(`That request is already ${req.status}`)
    }

    if (input.decision === 'refused') {
      // THE REASON IS REQUIRED ON A NO. An approval leaves behind the thing it
      // approved, which explains itself; a refusal leaves nothing at all, and
      // the person who asked is owed a sentence rather than a status.
      if (input.note === '') {
        throw new ApprovalRefusal(
          'Say why it is refused — that sentence is the only answer the person who asked will ever get',
        )
      }
      // HE RAISED IT, HE LEARNS WHAT HAPPENED. A refusal changes what the
      // person who asked has to say to a vendor — usually the vendor they had
      // already promised something to, which is why they raised it at all. So
      // it goes back to them and STAYS in their queue until they acknowledge
      // it; the sentence above is what they will read.
      //
      // Not told to themselves: an owner refusing their own request has
      // nothing to learn from it.
      const raiser = await roleOfRequester(rid, req.requested_by)
      const tell = req.requested_by === by ? null : raiser
      await txn((tx) =>
        recordAct(tx, rid, {
          id: input.id,
          action: 'refused',
          from: ['pending', 'challenged'],
          status: 'refused',
          by,
          note: input.note,
          decision: true,
          assignTo: tell,
        }),
      )
      return {
        ok: true,
        id: input.id,
        message:
          tell === null
            ? 'Refused. Nothing was changed.'
            : `Refused. The ${tell} sees it and the reason until they note it.`,
      }
    }

    // ─── a payment is APPROVED, never applied ───────────────────────────
    //
    // There is nothing here to apply. The money moves when a person makes the
    // transfer, from an account this screen has not chosen, and that is a
    // separate act recorded by whoever performs it. So the yes lands and the
    // request stays with the owner to ROUTE — pay it themselves, or forward
    // it to whoever will.
    //
    // applyRequest refuses this kind outright, which is the structural half of
    // the same rule: without it a payment falls into the DISCARD branch and
    // tries to close the vendor's code.
    if (req.kind === 'payment') {
      await txn((tx) =>
        recordAct(tx, rid, {
          id: input.id,
          action: 'approved',
          from: ['pending', 'challenged'],
          status: 'approved',
          by,
          note: input.note,
          decision: true,
          assignTo: 'owner',
        }),
      )
      return {
        ok: true,
        id: input.id,
        message: 'Approved. Nothing has moved yet — say how it will be paid.',
      }
    }

    // ─── the act ────────────────────────────────────────────────────────
    // One transaction: stamp the decision, write the event, run the function,
    // record what it returned. If the function raises, every one of those
    // rolls back and the FAILURE is written in a second transaction below —
    // because a failure that rolled back with the attempt would leave no
    // record that the owner ever said yes.
    let applied: unknown = null
    let failure: string | null = null
    try {
      applied = await txn(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
        await recordAct(tx, rid, {
          id: input.id,
          action: 'approved',
          from: ['pending', 'challenged'],
          status: 'approved',
          by,
          note: input.note,
          decision: true,
          assignTo: null,
        })

        // The destructive half lives in approvals-queries so a gate can call
        // it on a rolled-back transaction. Not exported from here: a function
        // that applies a request while taking the actor as a parameter must
        // not be a public endpoint.
        const result = await applyRequest(tx, rid, req, by, req.reason)

        // A POSITION STAMP, NOT AN ACT — which is why it is not another
        // recordAct. Applying is the consequence of the `approved` event a
        // few lines up, not a second thing that happened, and the event
        // vocabulary has no word for it. Same transaction either way.
        await tx`
          update approval_requests
          set status = 'applied', applied_at = now(), applied_result = ${JSON.stringify(result)}::text::jsonb
          where id = ${input.id} and restaurant_id = ${rid}`
        return result
      })
    } catch (e) {
      if (e instanceof ApprovalRefusal) throw e
      failure = e instanceof Error ? e.message.slice(0, 400) : 'unknown error'
    }

    if (failure !== null) {
      // THE OWNER SEES WHY. A yes that did nothing, with no record of the yes
      // and no reason, is the worst of the three outcomes — so the decision,
      // its event and the database's own words are written together in their
      // own transaction. The `from` list still holds: the first attempt rolled
      // back, so the row is exactly where it was.
      await txn(async (tx) => {
        await recordAct(tx, rid, {
          id: input.id,
          action: 'approved',
          from: ['pending', 'challenged'],
          status: 'failed',
          by,
          note: input.note,
          decision: true,
          assignTo: 'owner',
        })
        await tx`
          update approval_requests
          set applied_result = ${JSON.stringify({ error: failure })}::text::jsonb
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

/**
 * TAKING IT BACK — the act that leaves the least behind, which is why it is
 * the one that has to say the most.
 *
 * WHO, AND FROM WHERE, is `WITHDRAW_FROM`: the raiser while nobody has
 * decided, the owner also once he has approved it and before the money moves.
 * The ruling lives beside the query so the gate reads the same object this
 * does.
 *
 * IT USED TO CHECK NEITHER. `assertRequester()` alone admits store, chef,
 * manager and owner — and nothing compared the caller to `requested_by`, so
 * any of them could withdraw somebody else's pending request through a public
 * endpoint. The cheap role gate still runs FIRST, before the row is read, for
 * the reason every other act here does it: otherwise this answers "that
 * request is applied" to anybody signed in who guesses an id. The precise
 * check runs after, with the row in hand.
 *
 * THE REASON IS OPTIONAL, deliberately, and it is the one refusal-shaped act
 * in this file where that is right. A refusal is somebody being told no and
 * leaves nothing but the sentence, so its reason is required. A withdrawal is
 * the person who asked deciding not to ask any more — there is nobody
 * downstream who needs to be told why, and demanding a sentence would make
 * changing your mind cost more than the request did.
 */
export async function cancelApproval(id: string, reason?: string): Promise<ApprovalResult> {
  try {
    if (!UUID.test(id)) throw new ApprovalRefusal('Malformed request id')
    // THE CHEAP ROLE GATE RUNS FIRST, before the row is read — otherwise this
    // public endpoint answers "that request is applied" to anybody signed in
    // who guesses an id. The precise check runs under the lock, with the row.
    await assertRequester()
    const user = await getSessionUser()
    if (!user) throw new ApprovalRefusal('Sign in again — the session has expired')
    const restaurant = await getRestaurant()
    const note = reason === undefined || reason.trim() === '' ? undefined : reason.trim()

    return await txn(async (tx) => {
      const row = await assertWithdrawable(tx, restaurant.id, id, {
        username: user.username,
        role: user.role,
      })
      await recordAct(tx, restaurant.id, {
        id,
        action: 'cancelled',
        from: row.from,
        status: 'cancelled',
        by: user.username,
        note,
        // THE CURRENT POSITION IS NOW WITHDRAWN, and this is who put it there.
        // The approval it may displace is not lost: every act appends to
        // `approval_events`, and these columns were never the only record.
        decision: true,
        // NOBODY IS HOLDING IT. A badge that only grows is not a badge, and
        // this is one of the acts that takes the count back down.
        assignTo: null,
      })
      // READ BACK, NEVER ECHOED, and read AFTER the cancel so the count of
      // other open requests excludes the one just withdrawn.
      const standing =
        row.kind === 'payment' ? await getVendorStanding(tx, restaurant.id, row.entity_id) : null
      return {
        ok: true as const,
        id,
        message: withdrawnMessage(row.kind, standing, formatMoneyString),
      }
    })
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
      raw.entity === 'recipe'
        ? await tsql<{ id: string; code: string; name: string; units: string }[]>`
            select r.id, r.code, r.name, r.kind || ' · ' || r.output_unit as units
            from recipes r
            where r.restaurant_id = ${restaurant.id} and r.status = 'active'
              and r.id <> ${raw.exclude}
              and (r.name ilike ${like} or r.code ilike ${like})
            order by r.code limit 12`
      : raw.entity === 'item'
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
  // THE SUBJECT OF A REOPEN IS A PERIOD, AND THE CHECK DOES NOT ALLOW ONE.
  //
  // `approval_requests_entity_type_check` lists item · vendor · recipe · staff
  // · account · meter · location · list_value — and this path has always sent
  // 'period'. Before the CHECK existed, entity_type was free text and took it;
  // now the insert dies with a raw 23514 that reaches the accountant as a
  // database error on a screen where they are trying to explain themselves.
  //
  // IT NEEDS ONE LINE OF MIGRATION — 'period' added to that CHECK — and until
  // then the refusal is at least readable and names what is wrong. A raw
  // constraint violation is the worst of both: it stops the work AND says
  // nothing anybody can act on.
  try {
    if (!UUID.test(raw.periodCloseId)) throw new ApprovalRefusal('Malformed period')
    const reason = raw.reason.trim()
    if (reason === '') throw new ApprovalRefusal('Say why it needs reopening — that sentence is the record')
    const res = await requestApproval({
      kind: 'reopen_period',
      entity: 'period',
      fromId: raw.periodCloseId,
      toId: '',
      reason,
    })
    // READ THE CONSTRAINT BY NAME, never the raw message. Postgres names the
    // constraint and not the column, and a 23514 on screen is a stopped job
    // with nothing anybody can do about it.
    if (!res.ok && /entity_type_check/.test(res.error)) {
      throw new ApprovalRefusal(
        'Asking to reopen a month cannot be recorded yet: approval_requests_entity_type_check does not allow a period as a subject. It needs one line of migration — add \'period\' to that CHECK. Until then, ask the owner directly.',
      )
    }
    return res
  } catch (e) {
    return fail(e)
  }
}

// ─────────────────────────────────── a vendor payment by transfer ─────────

const PaymentRequestSchema = z.object({
  vendorId: z.string().regex(UUID),
  amount: z.string().trim().min(1),
  mode: z.string().trim().min(1).max(40),
  urgency: z.enum(['normal', 'overdue', 'urgent']),
  reason: z.string().trim().min(1).max(300),
  /** WHICH BILLS THIS IS ABOUT. Required on every new request and defaulted to
   *  everything, so it is never a field somebody has to think about to get the
   *  ordinary case right — but it is never absent either, because "pay them
   *  ₹64,815" and "pay them ₹64,815 for the first fortnight of August" are
   *  different asks and only one of them can be checked against anything.
   *
   *  SHAPE ONLY here. A `.refine()` message cannot reach the user — `fail()`
   *  collapses every ZodError to one sentence — so every rule that has
   *  something to say is thrown below instead. */
  billsFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billsTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export type PaymentRequestInput = z.infer<typeof PaymentRequestSchema>

/**
 * THE BILLS A RANGE IS CHOSEN FROM — one round trip, and none after it.
 *
 * The queue ships the oldest THREE bills per vendor and that cap is in SQL on
 * purpose: a row expands in place, and shipping 250 bills so that three can be
 * shown is how a payload starts growing with the ledger. Choosing a range
 * needs all of them for ONE vendor, so they are fetched when the request
 * branch opens rather than when the row does — the expand still costs nothing,
 * and every date change after this is arithmetic in the browser.
 *
 * A READ, so it writes nothing and acknowledges nothing. It is still gated:
 * every export from a `'use server'` file is a public endpoint, and this one
 * would otherwise answer any signed-in reader who guesses a vendor id.
 */
export async function loadVendorBills(
  vendorId: string,
): Promise<{ ok: true; bills: BillOutstandingRow[] } | { ok: false; error: string }> {
  try {
    if (!UUID.test(vendorId)) throw new ApprovalRefusal('Malformed vendor id')
    await assertRequester()
    const restaurant = await getRestaurant()
    return { ok: true, bills: await listBillsOutstanding(restaurant.id, vendorId) }
  } catch (e) {
    return fail(e)
  }
}

/** What was asked for, read back rather than echoed, so the acknowledgement
 *  can say "23 bills" without the screen counting its own preview. */
export type PaymentRequestResult =
  | {
      ok: true
      id: string
      message: string
      range: { from: string; to: string; bills: number; total: string }
    }
  | { ok: false; error: string }

/**
 * THE STORE MANAGER ASKS; HE DOES NOT PAY.
 *
 * He observes what is owed. He does not make the transfer, so he records no
 * payment and — this is the point — NAMES NO ACCOUNT. Which account the money
 * leaves is a fact about a payment that does not exist yet, and picking one
 * here would be him guessing at a balance he cannot see.
 *
 *   REQUEST: vendor · amount · reason · how urgent.
 *   PAYMENT: all of that PLUS the account, chosen by whoever makes the
 *            transfer, at the moment they make it.
 *
 * The snapshot freezes the ageing AS IT STOOD AT ASKING, so the approver can
 * compare it with the live figure rather than trust it: "₹1,53,330 was
 * outstanding when this was asked and ₹1,41,000 is now" is a fact neither
 * number states alone.
 */
export async function requestVendorPayment(raw: PaymentRequestInput): Promise<PaymentRequestResult> {
  try {
    const input = PaymentRequestSchema.parse(raw)
    const by = await assertRequester()
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    // A PAYMENT REQUEST WITH NO AMOUNT IS NOT A REQUEST ANYBODY CAN ACT ON.
    // The column's CHECK is (amount IS NULL OR amount > 0) — it permits a null
    // because the other request kinds have no amount, so requiring one for
    // THIS kind is the app's job.
    const paise = parseMoney(input.amount)
    if (paise === null || paise <= 0) throw new ApprovalRefusal('Enter an amount greater than zero')

    const aging = await getVendorAging(rid, input.vendorId)
    const [vendor] = await tsql<{ name: string }[]>`
      select name from vendors where restaurant_id = ${rid} and id = ${input.vendorId}`
    if (!vendor) throw new ApprovalRefusal('That vendor is not on this restaurant’s list')

    // REFUSED BY NAME. A request against a vendor who is owed nothing is
    // either a mistake or an advance nobody has said out loud.
    if (aging === null || decimalStringToPaise(aging.outstanding) <= 0) {
      throw new ApprovalRefusal(
        `${vendor.name} has nothing outstanding — there is no bill to settle. If this is an advance, record it as one rather than as a payment against bills.`,
      )
    }

    const range: DateRange = { from: input.billsFrom, to: input.billsTo }

    // EVERYTHING THAT DECIDES THIS REQUEST IS READ INSIDE THE LOCK — the range
    // total, the zero-bills refusal and the overlap check all describe a state
    // another save can move, and a check that passed before the lock has not
    // passed inside it.
    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const scope = await assertPayableRange(tx, rid, {
        vendorId: input.vendorId,
        vendorName: vendor.name,
        range,
        paise,
      })

      const [row] = await tx<{ id: string }[]>`
        insert into approval_requests
          -- 14 columns, 14 values. Counted rather than read: the two lists sit
          -- twenty lines apart, each is individually plausible, and the eye
          -- pairs them by position without ever holding both orders at once.
          (restaurant_id, kind, entity_type, entity_id, target_entity_id, reason, amount,
           suggested_mode, bills_from, bills_to, snapshot, status, assigned_to, requested_by)
        -- THE AMOUNT IS A COLUMN, not only a snapshot field. The snapshot is
        -- the ageing AS IT STOOD AT ASKING, kept to be COMPARED with the live
        -- figure; the amount is what is being asked for, which anything
        -- reading this queue needs without parsing jsonb.
        --
        -- The CHECK is (amount IS NULL OR amount > 0), so it permits a payment
        -- request with NO amount. It cannot know which kinds need one, so the
        -- refusal above is the app's job, not the constraint's.
        values (${rid}, 'payment', 'vendor', ${input.vendorId}, null, ${input.reason},
                ${(paise / 100).toFixed(2)}, ${input.mode},
                ${range.from}::date, ${range.to}::date,
                ${JSON.stringify({
                  amount: input.amount,
                  // SUGGESTED, NOT DECIDED. He says how he expected it to go;
                  // routed_mode is what the person who actually pays chose,
                  // and the two are allowed to differ — that difference is a
                  // fact worth keeping, not a correction to make silently.
                  mode: input.mode,
                  urgency: input.urgency,
                  vendorName: vendor.name,
                  askedOutstanding: aging.outstanding,
                  askedOpenBills: aging.open_bills,
                  askedOldestDue: aging.oldest_due,
                  askedTerms: aging.payment_terms,
                  // AS IT STOOD AT ASKING, which is the whole job of a
                  // snapshot. Part 3 compares the request's amount against the
                  // range total LIVE; these two are what make the difference
                  // explicable rather than merely visible.
                  askedRangeBills: scope.bills,
                  askedRangeTotal: scope.total,
                })}::text::jsonb, 'pending', 'owner', ${by})
        returning id`

      // THE TRAIL IS THE HISTORY; THE COLUMNS ARE ONLY THE CURRENT POSITION.
      // status, decided_by and the rest are derivable from the last event and
      // are kept because queries filter on them — so an act is recorded by
      // APPENDING here, never by overwriting a column that already holds an
      // earlier act. A trail with a hole at the start cannot be backfilled:
      // nothing else records who raised this or what they suggested.
      //
      // Written in the SAME transaction as the request, so a row can never
      // exist without the event that created it.
      // THE NOTE CARRIES THE RANGE so the trail reads without a join. The
      // raised note is never rendered as a quote — every reader skips it when
      // `last_action === 'raised'` — so it can afford to say more than the
      // reason alone.
      await tx`
        insert into approval_events (restaurant_id, request_id, action, note, mode, acted_by)
        values (${rid}, ${row.id}, 'raised',
                ${`${input.reason} — bills ${fmtRange(range.from, range.to)} (${scope.bills} ${scope.bills === 1 ? 'bill' : 'bills'})`},
                ${input.mode}, ${by})`
      return { id: row.id, bills: scope.bills, total: scope.total }
    })

    return {
      ok: true,
      id: saved.id,
      message: `${formatPaise(paise)} to ${vendor.name} — sent to the owner to pay and record`,
      range: { from: range.from, to: range.to, bills: saved.bills, total: saved.total },
    }
  } catch (e) {
    // THE MIGRATION IS NAMED RATHER THAN THE CONSTRAINT. Until
    // approval_requests_payment_kind is applied the CHECK refuses this row,
    // and "violates check constraint approval_requests_kind_check" tells the
    // store manager nothing he can act on.
    // THE BACKSTOP SPEAKS IN THE APP'S WORDS. Two store managers saving at the
    // same instant both pass the overlap read and the constraint refuses the
    // second — correctly, and with an index name nobody can act on. The
    // sentence is deliberately the same one the in-app check gives, because
    // the person meets one situation, not two.
    if (e instanceof Error && e.message.includes('approval_requests_no_overlapping_open_ranges')) {
      return {
        ok: false,
        error:
          'Somebody asked for an overlapping range for this vendor a moment ago. Reload the queue and pick a range that does not overlap it.',
      }
    }
    if (e instanceof Error && e.message.includes('approval_requests_kind_check')) {
      return {
        ok: false,
        error:
          'Transfer requests are not switched on yet — migration approval_requests_payment_kind has not been applied. Cash payments still record normally.',
      }
    }
    return fail(e)
  }
}

/**
 * "NOTED." — one tap, and the only thing it changes is who is holding this.
 *
 * THE STATUS DOES NOT MOVE. It is still refused, and it always will be; what
 * clears is the OBLIGATION. That is the whole reason `status` and
 * `assigned_to` are two columns rather than one — see the note on SEND_BACK —
 * and collapsing them here would mean either losing the outcome or losing the
 * fact that somebody was told.
 *
 * `decision` is deliberately false: acknowledging is not deciding, and
 * `decided_by` holds the owner who refused it. A column that records who did
 * something cannot be reused by the next person who does something.
 *
 * GOOD NEWS NEEDS NO ACT. A payment that went through appears on the raiser's
 * list and carries no badge and no button: it is news he needs so he stops
 * chasing, not news that demands anything. Badging it would train him to clear
 * badges rather than read them.
 */
export async function acknowledgeRequest(id: string): Promise<ApprovalResult> {
  try {
    if (!UUID.test(id)) throw new ApprovalRefusal('Malformed request id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const req = await getApproval(rid, id)
    if (!req) throw new ApprovalRefusal('That request no longer exists')
    if (req.assigned_to === null) {
      throw new ApprovalRefusal('Nothing is waiting on anybody for this one')
    }
    const by = await assertAssignee(
      req.assigned_to,
      `This is with the ${req.assigned_to} — only they or an owner can note it`,
    )

    await txn((tx) =>
      recordAct(tx, rid, {
        id,
        action: 'acknowledged',
        // Whatever it is, it stays that. Passing the status it already has is
        // the honest way to say "this act changes no outcome".
        from: [req.status],
        status: req.status,
        by,
        assignTo: null,
      }),
    )
    return { ok: true, id, message: 'Noted. It is off your list; the record and the reason stay.' }
  } catch (e) {
    return fail(e)
  }
}

// ══════════════════════════════════════ what happens to a payment after yes

const RouteSchema = z.object({
  id: z.string().regex(UUID),
  /** The mode the owner is choosing, which is allowed to differ from the one
   *  the store manager suggested. Two people knowing different things is not
   *  a discrepancy — he knows the vendor wants paying, the owner knows which
   *  account is liquid. */
  mode: z.string().trim().min(1).max(40),
  /** Optional: the owner may say which account they intend it to leave, or
   *  leave it to whoever pays. payApproval demands one either way. */
  accountId: z.union([z.literal(''), z.string().regex(UUID)]),
  assignTo: z.enum(PAYERS),
  note: z.string().trim().max(300),
})

/**
 * THE OWNER ROUTES IT — how it will be paid, and by whom.
 *
 * Routing is not deciding, and it is a separate act for a reason that only
 * shows up on a return: §3 says a return cancels the ROUTING and not the
 * APPROVAL, so the two have to be separable things or a return would be an
 * un-approval. The status stays `approved` throughout; what moves is the
 * mode, the account and whose queue it sits in.
 *
 * TWO EVENTS WHERE TWO THINGS HAPPENED. Choosing the mode is `routed`; handing
 * it to somebody else is `forwarded`. An owner paying it themselves does only
 * the first. Collapsing them would make the trail unable to say whether the
 * accountant was ever asked.
 */
export async function routePayment(raw: {
  id: string
  mode: string
  accountId: string
  assignTo: (typeof PAYERS)[number]
  note: string
}): Promise<ApprovalResult> {
  try {
    const input = RouteSchema.parse(raw)
    const by = await assertApprover()
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const req = await getApproval(rid, input.id)
    if (!req) throw new ApprovalRefusal('That request no longer exists')
    if (req.kind !== 'payment') throw new ApprovalRefusal('Only a payment request is routed')
    if (req.status !== 'approved') {
      throw new ApprovalRefusal(`That request is ${req.status} — only an approved one can be routed`)
    }

    // THE ACCOUNT IS CHECKED EVEN THOUGH IT IS OPTIONAL. An id that is not on
    // the active list would sit in routed_account_id until somebody tried to
    // pay from it, and the refusal would arrive at the worst moment.
    const accountId = input.accountId === '' ? null : await assertAccount(rid, input.accountId, 'the account this would leave')

    await txn(async (tx) => {
      await recordAct(tx, rid, {
        id: input.id,
        action: 'routed',
        from: ['approved'],
        status: 'approved',
        by,
        note: input.note,
        mode: input.mode,
        accountId,
        route: true,
        assignTo: 'owner',
      })
      if (input.assignTo !== 'owner') {
        await recordAct(tx, rid, {
          id: input.id,
          action: 'forwarded',
          from: ['approved'],
          status: 'approved',
          by,
          note: input.note,
          assignTo: input.assignTo,
        })
      }
    })

    return {
      ok: true,
      id: input.id,
      message:
        input.assignTo === 'owner'
          ? `${input.mode} — yours to pay and record.`
          : `${input.mode} — with the ${input.assignTo} to pay and record.`,
    }
  } catch (e) {
    return fail(e)
  }
}

const SendBackSchema = z.object({
  id: z.string().regex(UUID),
  reason: z.string().trim().min(1).max(300),
})

/**
 * A RETURN CANCELS THE ROUTING, NOT THE APPROVAL.
 *
 * The accountant cannot make this transfer — the account is short, the
 * beneficiary is not registered, the bank is down. None of that is an
 * objection to PAYING the vendor, so the yes stands and only the route comes
 * off: the status stays `approved`, the mode and the account are cleared, and
 * it goes back to the owner to be routed again rather than decided again.
 *
 * Sending it back to `pending` would erase the approval before it ever left,
 * and afterwards nobody could explain why the route changed. That is the
 * whole reason the trail exists.
 */
export async function returnRequest(raw: { id: string; reason: string }): Promise<ApprovalResult> {
  try {
    const input = SendBackSchema.parse(raw)
    // The cheap role gate FIRST, before a row is read: without it these
    // endpoints answer "that request is applied" to anybody signed in who
    // guessed an id. assertAssignee narrows it once the row is in hand.
    await assertPayer()
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const req = await getApproval(rid, input.id)
    if (!req) throw new ApprovalRefusal('That request no longer exists')
    if (req.status !== 'approved') {
      throw new ApprovalRefusal(`That request is ${req.status} — only an approved one can be sent back`)
    }
    if (req.assigned_to === 'owner' || req.assigned_to === null) {
      throw new ApprovalRefusal(
        'This is already with the owner — there is nobody to send it back to. Route it somewhere else instead.',
      )
    }
    const by = await assertAssignee(
      req.assigned_to,
      `This was routed to the ${req.assigned_to} — only they or an owner can send it back`,
    )

    await txn((tx) =>
      recordAct(tx, rid, {
        id: input.id,
        action: 'returned',
        from: ['approved'],
        by,
        note: input.reason,
        // §3, read from the one place it is declared.
        ...SEND_BACK.returned,
      }),
    )
    return { ok: true, id: input.id, message: 'Sent back to the owner. It is still approved — the route is not.' }
  } catch (e) {
    return fail(e)
  }
}

/**
 * `challenged` IS COLLAPSED INTO `returned`, AND NOT BECAUSE IT WAS WRONG.
 *
 * It was a real distinction — "I cannot pay it this way" against "I do not
 * think we should pay this" — and the accountant is the wrong person to draw
 * it. Three buttons made him classify WHY before he could act, and the
 * paragraph explaining the difference is a paragraph nobody reads at four in
 * the afternoon.
 *
 * HE STATES THE FACT; THE OWNER CLASSIFIES IT. "Their account is closed" and
 * "I do not think we owe this" both come back as a RETURN with a reason, and
 * the owner — who has the information to tell them apart — decides whether to
 * route it differently or drop it.
 *
 * THE STATUS STAYS IN THE SCHEMA. A status nothing writes costs nothing; one
 * dropped from a CHECK that history might reference costs a migration and a
 * row nobody can read. `decideApproval` still accepts `challenged` as a
 * decidable state for the same reason.
 */

const PaySchema = z.object({
  id: z.string().regex(UUID),
  accountId: z.string().regex(UUID),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.string().trim().min(1).max(40),
  note: z.string().trim().max(300),
})

/**
 * THE MONEY MOVED — the payments row and the `paid` event, in ONE transaction.
 *
 * A payment recorded with no event is money that moved with no account of who
 * moved it. An event with no payment is a trail asserting a payment that does
 * not exist. Both are worse than neither, and neither is repairable
 * afterwards: nothing else in the system knows which of the two you are
 * looking at. So the insert, the event and the status change share a handle,
 * and a failure anywhere in the three leaves nothing at all.
 *
 * THE AMOUNT IS THE APPROVED AMOUNT AND IS NOT TYPED AGAIN. What was approved
 * is what may be paid; paying a different figure is a different request, not
 * an edit of this one. A short payment is a return with a reason, which the
 * owner re-approves for the amount they mean.
 */
export async function payApproval(raw: {
  id: string
  accountId: string
  paidDate: string
  mode: string
  note: string
}): Promise<ApprovalResult> {
  try {
    const input = PaySchema.parse(raw)
    // The cheap role gate FIRST, before a row is read: without it these
    // endpoints answer "that request is applied" to anybody signed in who
    // guessed an id. assertAssignee narrows it once the row is in hand.
    const payer = await assertPayer()
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const req = await getApproval(rid, input.id)
    if (!req) throw new ApprovalRefusal('That request no longer exists')
    if (req.kind !== 'payment') throw new ApprovalRefusal('Only a payment request is settled by paying it')
    if (req.status !== 'approved') {
      throw new ApprovalRefusal(`That request is ${req.status} — only an approved one can be paid`)
    }
    const by = await assertAssignee(
      req.assigned_to,
      req.assigned_to === null
        ? 'Nobody has been asked to pay this yet — the owner routes it first'
        : `This is with the ${req.assigned_to} — only they or an owner can record the payment`,
    )

    // A REGEX IS NOT A CALENDAR. `2026-02-31` matches the shape and rolls
    // silently to 3 March in JS, or reaches Postgres and raises on a page
    // somebody is mid-save on. The same check the bill and payment forms run.
    const d = new Date(`${input.paidDate}T00:00:00Z`)
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.paidDate) {
      throw new ApprovalRefusal('That is not a real calendar date')
    }

    const paise = req.amount === null ? null : decimalStringToPaise(req.amount)
    if (paise === null || paise <= 0) {
      throw new ApprovalRefusal(
        'That request carries no amount, so there is nothing to pay against it — raise a new one',
      )
    }
    // The account is refused by name here, outside the transaction, because
    // the refusal reaches the user in its own words rather than as a
    // foreign-key violation nobody can read.
    // TWO EXTRA ROUND TRIPS, DELIBERATELY — do not optimise them away.
    //
    // The screen already holds a bill count and a balance, and echoing them
    // would cost nothing. It would also be a RESTATEMENT WEARING A RESULT'S
    // CLOTHES: "23 bills cleared" would be repeating what was on screen before
    // the write rather than reporting what the write did. Post-save figures
    // come from the database, never from what was typed — the rule the void
    // toasts were fixed under, and the reason `duesBefore` is read here too.
    //
    // This runs a few times a day at ~6ms a read. It is the cheapest
    // correctness in the app.
    const before = await getVendorAging(rid, req.entity_id)
    const billsBefore = before?.open_bills ?? 0
    const accountId = await assertAccount(rid, input.accountId, 'the account this payment left')

    const paid = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      // RE-READ FOR UPDATE, BEFORE THE MONEY. The status and assignee were
      // checked above, outside the transaction — a courtesy that makes the
      // common refusal fast and readable, and not the check. Between that read
      // and this line somebody else can pay it, return it or re-route it.
      //
      // `recordAct` refuses a moved STATUS on its own and always has, so money
      // has never been able to move twice. What it cannot see is a RETURN:
      // §3 leaves the status at `approved` and only changes `assigned_to`, so
      // a request taken off the accountant still satisfies `from: ['approved']`
      // and a stale screen would pay it. Two questions, both asked here.
      const locked = await assertStillPayable(tx, rid, input.id, payer.role)

      // AND IS THE FIGURE STILL COVERED. A bill in the range can be voided or
      // settled between approval and payment, and nothing about the request
      // changes when it is — so the request would pay more than the bills it
      // names are worth, silently. Recomputed under the same lock.
      await assertAmountStillCovered(tx, rid, locked)

      const payment = await insertPayment(tx, rid, {
        vendorId: req.entity_id,
        paidDate: input.paidDate,
        amountPaise: paise,
        mode: input.mode,
        note: input.note,
        accountId,
        enteredBy: by,
      })
      await recordAct(tx, rid, {
        id: input.id,
        action: 'paid',
        from: ['approved'],
        status: 'applied',
        by,
        note: input.note,
        mode: input.mode,
        accountId,
        // NOT `route: true`. The account named here is the one the money
        // actually left; routed_account_id is the one the owner chose, and
        // they are allowed to differ.
        assignTo: null,
      })
      await tx`
        update approval_requests
        set applied_at = now(),
            applied_result = ${JSON.stringify({ paid: payment.doc_no, payment_id: payment.id, amount: payment.amount })}::text::jsonb
        where id = ${input.id} and restaurant_id = ${rid}`
      return payment
    })

    // READ BACK WHAT MOVED, never echo what was typed. The vendor's balance
    // and the account's are both facts about after the write.
    const [after, balances] = await Promise.all([
      getVendorAging(rid, req.entity_id),
      getAccountBalances(rid),
    ])
    const acct = balances.find((b) => b.account_id === accountId)
    const owedAfter = after === null ? 0 : decimalStringToPaise(after.outstanding)
    const cleared = billsBefore - (after?.open_bills ?? 0)
    return {
      ok: true,
      id: input.id,
      // THE NUMBER WAS ALLOCATED AND THROWN AWAY. `paid` was assigned and
      // never read — the linter said so — and what it holds is the PAY series
      // number, which is the one thing on this receipt an accountant will
      // quote months later and the one figure no screen already carries.
      // Saying numbers rather than a checkmark is the rule; this was the
      // number.
      message: `${formatPaise(paise)} paid to ${req.from_name ?? 'the vendor'}${
        acct === undefined ? '' : ` from ${acct.name}`
      }${paid.doc_no === null ? '' : ` — ${paid.doc_no}`}. ${
        owedAfter <= 0
          ? `They owe nothing${cleared > 0 ? ` — ${cleared} ${cleared === 1 ? 'bill' : 'bills'} cleared` : ''}.`
          : `They are now owed ${formatPaise(owedAfter)}.`
      } Not on a bank statement yet — nothing here has been reconciled against one.`,
    }
  } catch (e) {
    return fail(e)
  }
}
