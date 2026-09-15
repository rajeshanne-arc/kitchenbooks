'use client'

// The owner's queue for the two things that leave nothing behind.
//
// EACH REQUEST SHOWS THREE THINGS AND KEEPS THEM APART: the REASON, the
// SNAPSHOT taken when it was asked, and A FRESH CHECK RUN NOW. Where the two
// disagree the screen says so — a bill can land against the closing item while
// the request sits here, and "0 references when asked, 1 now" is a fact the
// owner needs that neither number can state on its own.
//
// The fresh check is still not the authority. merge_items re-runs every guard
// itself, under a row lock, at the moment of applying; this is what the owner
// reads before deciding, and the function is what decides whether it works.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Honesty from '@/components/Honesty'
import SaveAck from '@/components/SaveAck'
import { decideApproval } from '@/server/approvals-actions'
import type { ApprovalRow, AwaitingRow, Preview, RefCount, VendorRouting } from '@/server/approvals-queries'
import RouteControl from '@/components/approvals/RouteControl'
import type { AccountBalanceRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { btnCls, btnGhostCls, cardCls, codeCls, fieldLabelCls, inputCls } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'
import NameFigure from '@/components/NameFigure'
import { readObject } from '@/lib/read-object'

export type QueueItem = {
  row: AwaitingRow
  /** re-run at page load. Null when the request can no longer be previewed at
   *  all — the row was closed by something else in the meantime. */
  fresh: Preview | null
  freshError: string | null
}

/** What a row is called in one line, wherever it is listed. */
function what(r: ApprovalRow): string {
  return r.kind === 'payment'
    ? `Pay ${r.from_name ?? 'a vendor'}`
    : r.kind === 'discard'
      ? `Discard ${r.from_code ?? '—'}`
      : r.kind === 'reopen_period'
        ? 'Reopen a closed month'
        : `Merge ${r.from_code ?? '—'} → ${r.to_code ?? '—'}`
}

export default function ApprovalsClient({
  items,
  balances,
  elsewhere,
  decided,
  vendors,
  modes,
  today,
}: {
  items: QueueItem[]
  balances: AccountBalanceRow[]
  /** open, and with somebody else. Context, never work — see listElsewhere. */
  elsewhere: AwaitingRow[]
  decided: AwaitingRow[]
  /** keyed by vendor id, for the payments only — where the money would go */
  vendors: Record<string, VendorRouting>
  modes: string[]
  /** the BUSINESS day, resolved on the server. A `new Date()` here says
   *  tomorrow at 00:30, which is the fault the business day exists to stop. */
  today: string
}) {
  const [ack, setAck] = useState<string | null>(null)

  // NO SPLIT ON STATUS HERE ANY MORE. The page used to divide its own list
  // into pending and decided; both halves now arrive as their own list from
  // awaiting_me and from listDecided, so the screen cannot classify a row
  // differently from the badge that counted it.
  return (
    <div className="space-y-4">
      {ack !== null && <SaveAck headline={ack} />}

      {items.length === 0 ? (
        <section className={cardCls}>
          <p className="text-sm text-stone-600">
            Nothing is waiting on you. A payment somebody has asked you to make comes here, and so do the
            two things that leave no trace of their own — a discard and a merge. A void, a retirement or a
            re-filed count never will.
          </p>
        </section>
      ) : (
        items.map((i) => (
          <Request
            key={i.row.id}
            item={i}
            balances={balances}
            vendor={vendors[i.row.entity_id]}
            modes={modes}
            today={today}
            onDone={setAck}
          />
        ))
      )}

      {/* WHERE IT WENT. The instant a payment is forwarded it leaves this
          queue — correctly — and would otherwise vanish from the only screen
          the owner ever saw it on. This is the answer to the question that
          correctness creates, not a second queue. */}
      {elsewhere.length > 0 && (
        <section className={cardCls}>
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
            Out with somebody else
          </h3>
          <ul className="mt-2 divide-y divide-rule-soft">
            {elsewhere.map((r) => (
              <li key={r.id} className="py-2">
                <NameFigure
                  name={what(r)}
                  figure={r.amount === null ? null : formatMoneyString(r.amount)}
                />
                <p className="mt-0.5 text-xs text-stone-500">
                  with the {r.assigned_to} since {fmtDateTime(r.last_at ?? r.requested_at)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {decided.length > 0 && (
        <section className={cardCls}>
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Already decided</h3>
          <ul className="mt-2 divide-y divide-rule-soft">
            {decided.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <StatusChip status={r.status} />
                  <span className="font-medium text-stone-800">{what(r)}</span>
                  <span className="text-stone-500">“{r.reason}”</span>
                  {r.decided_by !== null && (
                    <span className="ml-auto text-xs text-stone-400">
                      {r.decided_by} · {r.decided_at === null ? '' : fmtDateTime(r.decided_at)}
                    </span>
                  )}
                </div>
                {/* A FAILURE KEEPS ITS REASON. An approval that could not be
                    applied is not a refusal and must not read like one. */}
                {r.status === 'failed' && (
                  <p className="mt-1 text-[13px] text-red-800">
                    Approved, but it could not be applied:{' '}
                    <FailureReason result={r.applied_result} />
                  </p>
                )}
                {r.status === 'applied' && <AppliedLine result={r.applied_result} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** The sentence for a value that is present and will not read. Deliberately
 *  NOT the empty state: it names a fault rather than a gap. */
function Unreadable({ what }: { what: string }) {
  return (
    <span className="text-red-800">
      the {what} is stored in a shape this screen cannot read — the figures are
      unavailable, not absent
    </span>
  )
}

/**
 * WHY A YES DID NOTHING. The reason is the whole of what the owner gets from a
 * failed apply, so "no reason recorded" must mean nobody recorded one — not
 * that the record is there and will not read. This site was the one the jsonb
 * fix missed: it still cast the column raw while the three reads beside it
 * went through the parser.
 */
function FailureReason({ result }: { result: unknown }) {
  const read = readObject<{ error?: string }>(result)
  if (read.state === 'unreadable') return <Unreadable what="reason" />
  if (read.state === 'absent' || read.value.error === undefined) return <>no reason recorded</>
  return <>{read.value.error}</>
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === 'applied'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : status === 'failed'
        ? 'border-red-200 bg-red-50 text-red-700'
        : status === 'refused'
          ? 'border-stone-300 bg-stone-100 text-stone-600'
          : 'border-amber-300 bg-amber-50 text-amber-800'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>
      {status}
    </span>
  )
}

function AppliedLine({ result }: { result: unknown }) {
  const read = readObject<{ from?: string; to?: string; moved?: Record<string, number>; discarded?: string; reopened?: string; paid?: string }>(result)
  if (read.state === 'absent') return null
  if (read.state === 'unreadable') {
    return (
      <p className="mt-1 text-[13px]">
        <Unreadable what="result" />
      </p>
    )
  }
  const r = read.value
  if (r.discarded !== undefined) return <p className="mt-1 text-[13px] text-stone-600">{r.discarded} discarded.</p>
  if (r.reopened !== undefined) return <p className="mt-1 text-[13px] text-stone-600">{r.reopened} reopened.</p>
  if (r.paid !== undefined) return <p className="mt-1 text-[13px] text-stone-600">Paid — {r.paid}.</p>
  // A MERGE IS THE ONLY KIND WITH A SURVIVOR TO POINT AT, so it is the only
  // one that may use this sentence. Reaching it without both codes means the
  // result was not a merge — say nothing rather than interpolate `undefined`
  // into a sentence somebody will read as a fact.
  if (r.from === undefined || r.to === undefined) return null
  const moved = Object.entries(r.moved ?? {})
  const total = moved.reduce((a, [, n]) => a + n, 0)
  return (
    <p className="mt-1 text-[13px] text-stone-600">
      {total === 0
        ? `${r.from} points at ${r.to}. Nothing had to move.`
        : `${total} row(s) moved: ${moved.map(([t, n]) => `${t} ${n}`).join(' · ')}`}
    </p>
  )
}

function Request({
  item,
  balances,
  vendor,
  modes,
  today,
  onDone,
}: {
  item: QueueItem
  balances: AccountBalanceRow[]
  vendor: VendorRouting | undefined
  modes: string[]
  today: string
  onDone: (m: string) => void
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { row, fresh, freshError } = item
  const snapRead = readObject<{
    refs?: RefCount[]
    totalRefs?: number
    cost?: { before: string | null; after: string | null } | null
  }>(row.snapshot)
  const snap = snapRead.state === 'ok' ? snapRead.value : null

  const askedRefs = snap?.totalRefs ?? null
  const nowRefs = fresh?.totalRefs ?? null
  const drifted = askedRefs !== null && nowRefs !== null && askedRefs !== nowRefs

  // A DECISION IS ONLY AVAILABLE WHERE THERE IS ONE TO MAKE. `pending` has
  // never been answered; `challenged` is a question somebody put BACK to the
  // owner, so it is decidable in exactly the same way. An `approved` payment
  // is past deciding — what it needs is routing, which is a different act.
  const decidable = row.status === 'pending' || row.status === 'challenged'

  async function decide(decision: 'approved' | 'refused') {
    setBusy(true)
    setError(null)
    const r = await decideApproval({ id: row.id, decision, note: note.trim() })
    setBusy(false)
    if (!r.ok) setError(r.error)
    else onDone(r.message)
    router.refresh()
  }

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-baseline gap-2">
        <StatusChip status={row.status} />
        <h3 className="text-base font-semibold text-stone-900">
          {row.kind === 'payment' ? (
            <>
              Pay <span className={codeCls}>{row.from_code}</span> {row.from_name}
            </>
          ) : row.kind === 'discard' ? (
            <>
              Discard <span className={codeCls}>{row.from_code}</span> {row.from_name}
            </>
          ) : (
            <>
              Merge <span className={codeCls}>{row.from_code}</span> into{' '}
              <span className={codeCls}>{row.to_code}</span>
            </>
          )}
        </h3>
        <span className="ml-auto text-xs text-stone-400">
          {row.requested_by ?? 'someone'} · {fmtDateTime(row.requested_at)}
        </span>
      </div>

      {/* THE REASON IS THE POINT OF THE WHOLE ROW. After this is applied there
          is no negative twin to read; this sentence is the record. */}
      <p className="mt-2 rounded-lg border border-rule bg-field px-3 py-2 text-sm text-stone-800">
        “{row.reason}”
      </p>

      {/* WHY IT IS SITTING HERE, in the words of the last thing that happened
          to it. §3 leaves a return at `approved` — the approval stands and the
          ROUTE came off — so status alone cannot tell a fresh approval from
          one the accountant sent back. The event can, and it is the only thing
          that can. */}
      {row.status === 'approved' && (
        <div className="mt-3">
          {row.last_action === 'returned' ? (
            <Honesty verdict="sent back">
              {row.last_by ?? 'Somebody'} could not pay it this way
              {row.last_note === null ? '' : ` — “${row.last_note}”`}. The approval stands; what came off is
              the route. It needs saying again how it will be paid.
            </Honesty>
          ) : (
            <Honesty verdict="approved, not paid">
              Nothing has moved. Approving said yes; how it goes and who does it is the block below.
            </Honesty>
          )}
        </div>
      )}

      {row.status === 'challenged' && (
        <div className="mt-3">
          <Honesty verdict="challenged" level="alarm">
            {row.last_by ?? 'Somebody'} does not think this should be paid
            {row.last_note === null ? '' : ` — “${row.last_note}”`}. That is an objection to the payment
            rather than to the route, so it is back with you to decide again.
          </Honesty>
        </div>
      )}

      {row.kind === 'payment' && <PaymentAsk row={row} balances={balances} />}

      {/* THE ACT THAT TURNS A DECISION INTO A PAYMENT. Only once it is
          approved: routing something nobody has said yes to would be choosing
          an account for a payment that may never happen. */}
      {row.kind === 'payment' && row.status === 'approved' && (
        <RouteControl
          row={row}
          vendor={vendor}
          balances={balances}
          modes={modes}
          today={today}
          onDone={onDone}
        />
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-rule bg-white p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">When it was asked</div>
          <p className="mt-1 text-sm text-stone-700">
            {snapRead.state === 'unreadable' ? (
              <Unreadable what="snapshot" />
            ) : askedRefs === null ? (
              'no snapshot recorded'
            ) : (
              `${askedRefs} row(s) pointed at it`
            )}
          </p>
          {snap?.cost != null && snap.cost.before !== null && (
            <p className="mt-0.5 font-mono text-[12px] text-stone-500">
              ₹{snap.cost.before} → ₹{snap.cost.after}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-rule bg-white p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Checked just now</div>
          {freshError !== null ? (
            <p className="mt-1 text-sm text-red-800">{freshError}</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-stone-700">
                {nowRefs === null ? '—' : `${nowRefs} row(s) point at it`}
              </p>
              {fresh?.cost != null && fresh.cost.before !== null && (
                <p className="mt-0.5 font-mono text-[12px] text-stone-500">
                  ₹{fresh.cost.before} → ₹{fresh.cost.after}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* SAID, NOT HIDDEN. A check that passed on Tuesday has not passed on
          Thursday, and the difference is the finding. */}
      {drifted && (
        <div className="mt-3">
          <Honesty verdict="It moved" level="alarm">
            This had {askedRefs} row(s) pointing at it when it was asked and has {nowRefs} now — something
            was entered against it in between. Read the reason again before approving: it may no longer
            describe what you would be doing.
          </Honesty>
        </div>
      )}

      {fresh !== null && (
        <ul className="mt-3 space-y-1">
          {fresh.checks.map((c) => (
            <li key={c.label} className="flex items-baseline gap-2 text-sm">
              <span className={c.ok ? 'text-emerald-700' : 'text-red-700'}>{c.ok ? '✓' : '✗'}</span>
              <span>
                <span className={c.ok ? 'text-stone-700' : 'font-medium text-red-800'}>{c.label}</span>
                <span className="text-stone-500"> — {c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {fresh !== null && !fresh.wouldApply && (
        <div className="mt-3">
          <Honesty verdict="Would fail" level="alarm">
            Approving this now would not apply — the database refuses it under a lock, and the request would
            land in <span className="font-semibold">failed</span> with that reason on it rather than in
            applied. Refuse it, or have the blocker cleared and let them ask again.
          </Honesty>
        </div>
      )}

      {/* OPTIONAL ON A YES, REQUIRED ON A NO. An approval leaves behind the
          thing it approved, which explains itself; a refusal leaves nothing at
          all, and the person who asked is owed a sentence rather than a
          status. The server refuses a blank one by name — this only stops the
          form saying "optional" about a field the save will insist on. */}
      <label className="mt-3 block">
        <span className={fieldLabelCls}>Note — required to refuse</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} maxLength={300} />
      </label>

      {error !== null && (
        <div className="mt-3">
          <Honesty verdict="Not applied" level="alarm">
            {error}
          </Honesty>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {decidable && (
          <button type="button" onClick={() => decide('approved')} disabled={busy} className={btnCls}>
            {/* A PAYMENT IS NOT APPLIED, AND THE BUTTON MUST NOT SAY IT IS.
                Approving one moves no money and writes no payments row: it
                says yes, and how it is paid is a separate act by whoever
                makes the transfer. Everything else really is applied on the
                spot, under a lock, by a database function. */}
            {busy ? 'Working…' : row.kind === 'payment' ? 'Approve' : 'Approve and apply'}
          </button>
        )}
        <button
          type="button"
          onClick={() => decide('refused')}
          disabled={busy || note.trim() === ''}
          className={btnGhostCls}
        >
          Refuse
        </button>
      </div>
    </section>
  )
}


/**
 * THE QUESTION THE OWNER IS ACTUALLY ANSWERING IS "PAY FROM WHERE".
 *
 * "Approve yes or no" is the shape of a discard. A payment is different: the
 * amount was argued for by whoever asked, and what the owner brings to it is
 * the one fact the store manager could not see — which account has the money.
 * A large request against a small till needs a transfer, and the screen says
 * so rather than leaving him to remember it.
 *
 * THE REQUEST CARRIES NO ACCOUNT and this does not pick one either. It shows
 * what each could cover; the account is named at the moment the payment is
 * made and recorded, by the person making it.
 *
 * The snapshot is the ageing AS IT STOOD AT ASKING — shown so the two can be
 * compared, not so it can be trusted, the same reason a discard preview shows
 * both the asked and the fresh figure.
 */
function PaymentAsk({ row, balances }: { row: ApprovalRow; balances: AccountBalanceRow[] }) {
  const snapRead = readObject<{
    amount?: string
    mode?: string
    urgency?: string
    advanceIntent?: boolean
    askedOutstanding?: string
    askedOpenBills?: number
    askedOldestDue?: string | null
  }>(row.snapshot)
  const snap = snapRead.state === 'ok' ? snapRead.value : null
  // A REQUEST WHOSE SNAPSHOT CANNOT BE READ still shows its live figures —
  // the "as it stood at asking" half is simply absent, which is the honest
  // state for the four rows written before the encoding was fixed.
  const askPaise = snap?.amount === undefined ? 0 : decimalStringToPaise(snap.amount)
  const covering = balances.filter((b) => decimalStringToPaise(b.balance) >= askPaise)

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-2xl font-bold tabular-nums text-stone-900">
          {snap?.amount === undefined ? '\u2014' : formatMoneyString(snap.amount)}
        </span>
        {/* AN EM-DASH MEANS "nobody asked for an amount"; it must not also
            mean "the amount is there and will not read". */}
        {snapRead.state === 'unreadable' && (
          <span className="text-xs">
            <Unreadable what="snapshot" />
          </span>
        )}
        {snap?.mode !== undefined && <span className="text-sm text-stone-500">by {snap.mode}</span>}
        {snap?.urgency !== undefined && snap.urgency !== 'normal' && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
            {snap.urgency}
          </span>
        )}
        {snap?.advanceIntent === true && (
          <span className="rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
            advance
          </span>
        )}
      </div>

      {snap?.askedOutstanding !== undefined && (
        <p className="text-xs text-stone-500">
          When this was asked: {formatMoneyString(snap.askedOutstanding)} outstanding
          {snap?.askedOpenBills !== undefined && <> across {snap.askedOpenBills} bills</>}
          {snap?.askedOldestDue !== undefined && snap.askedOldestDue !== null && (
            <>, oldest due {fmtDate(snap.askedOldestDue)}</>
          )}
          .
        </p>
      )}

      <div className="rounded-xl border border-rule bg-white p-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">What each account can cover</h4>
        {balances.length === 0 ? (
          <p className="mt-1.5 text-sm text-stone-600">
            No money accounts exist yet, so nothing can say where this would be paid from.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {balances.map((b) => {
              const enough = decimalStringToPaise(b.balance) >= askPaise
              return (
                <li key={b.account_id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate text-stone-700">
                    {b.name}
                    <span className="ml-1.5 text-xs text-stone-400">{b.kind}</span>
                    {/* A TILL\u2019S BALANCE IS COUNTED, NOT COMPUTED, and the
                        two are different claims \u2014 one you can check against
                        a hand of notes, one derived from arithmetic. */}
                    {b.basis === 'counted' && b.counted_on !== null && (
                      <span className="ml-1.5 text-xs text-stone-400">counted {fmtDate(b.counted_on)}</span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 tabular-nums ${enough ? 'font-semibold text-emerald-800' : 'text-stone-400'}`}
                  >
                    {formatMoneyString(b.balance)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {balances.length > 0 && covering.length === 0 && askPaise > 0 && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
            No single account holds {formatMoneyString(snap?.amount ?? '0')}. This needs a transfer between
            accounts first, or paying in parts \u2014 worth knowing before approving rather than after.
          </p>
        )}
      </div>

      <p className="text-xs text-stone-500">
        Approving does not move money and does not touch an account. Whoever makes the transfer records the
        payment and names the account at that moment \u2014 the only point at which anybody knows it.
      </p>
    </div>
  )
}
