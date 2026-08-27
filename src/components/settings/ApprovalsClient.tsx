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
import type { ApprovalRow, Preview, RefCount } from '@/server/approvals-queries'
import { btnCls, btnGhostCls, cardCls, codeCls, fieldLabelCls, inputCls } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'

export type QueueItem = {
  row: ApprovalRow
  /** re-run at page load. Null when the request can no longer be previewed at
   *  all — the row was closed by something else in the meantime. */
  fresh: Preview | null
  freshError: string | null
}

export default function ApprovalsClient({ items }: { items: QueueItem[] }) {
  const [ack, setAck] = useState<string | null>(null)
  const pending = items.filter((i) => i.row.status === 'pending')
  const decided = items.filter((i) => i.row.status !== 'pending')

  return (
    <div className="space-y-4">
      {ack !== null && <SaveAck headline={ack} />}

      {pending.length === 0 ? (
        <section className={cardCls}>
          <p className="text-sm text-stone-600">
            Nothing is waiting. Discards and merges are the only two things in this app that leave no trace
            of their own, so they come here; a void, a retirement or a re-filed count never will.
          </p>
        </section>
      ) : (
        pending.map((i) => <Request key={i.row.id} item={i} onDone={setAck} />)
      )}

      {decided.length > 0 && (
        <section className={cardCls}>
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Already decided</h3>
          <ul className="mt-2 divide-y divide-rule-soft">
            {decided.map((i) => (
              <li key={i.row.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <StatusChip status={i.row.status} />
                  <span className="font-medium text-stone-800">
                    {i.row.kind === 'discard'
                      ? `Discard ${i.row.from_code ?? '—'}`
                      : `Merge ${i.row.from_code ?? '—'} → ${i.row.to_code ?? '—'}`}
                  </span>
                  <span className="text-stone-500">“{i.row.reason}”</span>
                  {i.row.decided_by !== null && (
                    <span className="ml-auto text-xs text-stone-400">
                      {i.row.decided_by} · {i.row.decided_at === null ? '' : fmtDateTime(i.row.decided_at)}
                    </span>
                  )}
                </div>
                {/* A FAILURE KEEPS ITS REASON. An approval that could not be
                    applied is not a refusal and must not read like one. */}
                {i.row.status === 'failed' && (
                  <p className="mt-1 text-[13px] text-red-800">
                    Approved, but it could not be applied:{' '}
                    {(i.row.applied_result as { error?: string } | null)?.error ?? 'no reason recorded'}
                  </p>
                )}
                {i.row.status === 'applied' && <AppliedLine result={i.row.applied_result} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
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
  const r = result as { from?: string; to?: string; moved?: Record<string, number>; discarded?: string } | null
  if (r === null) return null
  if (r.discarded !== undefined) return <p className="mt-1 text-[13px] text-stone-600">{r.discarded} discarded.</p>
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

function Request({ item, onDone }: { item: QueueItem; onDone: (m: string) => void }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { row, fresh, freshError } = item
  const snap = row.snapshot as {
    refs?: RefCount[]
    totalRefs?: number
    cost?: { before: string | null; after: string | null } | null
  } | null

  const askedRefs = snap?.totalRefs ?? null
  const nowRefs = fresh?.totalRefs ?? null
  const drifted = askedRefs !== null && nowRefs !== null && askedRefs !== nowRefs

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
          {row.kind === 'discard' ? (
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

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-rule bg-white p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">When it was asked</div>
          <p className="mt-1 text-sm text-stone-700">
            {askedRefs === null ? 'no snapshot recorded' : `${askedRefs} row(s) pointed at it`}
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

      <label className="mt-3 block">
        <span className={fieldLabelCls}>Note (optional)</span>
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
        <button type="button" onClick={() => decide('approved')} disabled={busy} className={btnCls}>
          {busy ? 'Working…' : 'Approve and apply'}
        </button>
        <button type="button" onClick={() => decide('refused')} disabled={busy} className={btnGhostCls}>
          Refuse
        </button>
      </div>
    </section>
  )
}
