'use client'

// "Merge into…" and "Discard" on an item or a vendor.
//
// NEITHER BUTTON ACTS. Both raise a request and stop — the owner decides, and
// the function applies. That split is the whole feature: a discard and a merge
// are the only two things in this app that leave NOTHING behind unless
// somebody writes it down on purpose, and everything else that removes or
// corrects — a void, a retirement, a re-filed closing — leaves a trace by
// construction and therefore needs no permission at all.
//
// THE PREVIEW IS THE FEATURE. The owner is being asked to approve something
// invisible; without a list of exactly what moves and exactly what changes,
// their yes is a signature on a blank page. So the preview runs BEFORE the ask
// as well as at the decision, and the reason is required.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Honesty from '@/components/Honesty'
import SaveAck from '@/components/SaveAck'
import {
  previewChange,
  requestApproval,
  searchMergeTargets,
  cancelApproval,
} from '@/server/approvals-actions'
import type { ApprovalEntity, Preview } from '@/server/approvals-queries'
import {
  btnCls,
  btnGhostCls,
  cardCls,
  codeCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import { tabHref } from '@/lib/routes'

type Row = { id: string; code: string; name: string; status: string }
type Target = { id: string; code: string; name: string; units: string }

/** A pending or approved request already standing against this row. */
/** The word each kind of row goes by in the sentences. Mirrors ENTITIES on the
 *  server; kept here rather than passed as a prop so a new entity type is one
 *  edit that a reviewer sees beside the copy it changes. */
const ENTITY_NOUN: Record<ApprovalEntity, string> = {
  item: 'item',
  vendor: 'vendor',
  recipe: 'recipe',
  account: 'money account',
  meter: 'meter',
  location: 'storage location',
  list_value: 'list value',
  period: 'period',
}

export type OpenRequest = { id: string; kind: string; reason: string; requested_by: string | null; status: string }

export default function MasterActions({
  entity,
  row,
  open,
  canRequest,
}: {
  entity: ApprovalEntity
  row: Row
  open: OpenRequest | null
  /** LAW 1 on a control rather than a link: a reader who cannot raise one is
   *  not shown the buttons. The action re-checks the role anyway, because a
   *  server action is a public endpoint and a hidden button is not a check. */
  canRequest: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'none' | 'merge' | 'discard'>('none')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Target[]>([])
  const [target, setTarget] = useState<Target | null>(null)
  // KEYED, NOT CLEARED. The preview is stored against the question it answers,
  // so changing the target DERIVES an empty panel instead of setting one — no
  // synchronous setState in an effect, and no flash of the previous answer
  // under the new question, which on this screen would be a wrong list of what
  // moves.
  const [answer, setAnswer] = useState<{ key: string; preview: Preview | null; error: string | null } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const noun = ENTITY_NOUN[entity]

  // ── the target typeahead ──────────────────────────────────────────────
  const searching = mode === 'merge' && q.trim().length >= 2
  useEffect(() => {
    if (!searching) return
    let live = true
    const t = setTimeout(() => {
      void searchMergeTargets({ entity, q: q.trim(), exclude: row.id }).then((r) => {
        if (live && r.ok) setHits(r.rows)
      })
    }, 180)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, searching, entity, row.id])
  const shownHits = searching ? hits : []

  // ── the preview, refreshed whenever the question changes ──────────────
  const askable = mode === 'discard' || (mode === 'merge' && target !== null)
  const key = `${mode}|${target?.id ?? ''}`
  useEffect(() => {
    if (!askable) return
    let live = true
    void previewChange({
      kind: mode === 'discard' ? 'discard' : 'merge',
      entity,
      fromId: row.id,
      toId: target?.id ?? '',
    }).then((r) => {
      if (!live) return
      setAnswer(r.ok ? { key, preview: r.preview, error: null } : { key, preview: null, error: r.error })
    })
    return () => {
      live = false
    }
  }, [askable, key, mode, target?.id, entity, row.id])

  // Derived, so an answer to the PREVIOUS question is never shown under this
  // one — the panel is blank until the reply for this exact key arrives.
  const current = answer !== null && answer.key === key ? answer : null
  const preview = current?.preview ?? null
  const previewError = current?.error ?? null

  const reset = () => {
    setMode('none')
    setQ('')
    setHits([])
    setTarget(null)
    setAnswer(null)
    setReason('')
    setError(null)
  }

  async function submit() {
    setBusy(true)
    setError(null)
    const r = await requestApproval({
      kind: mode === 'discard' ? 'discard' : 'merge',
      entity,
      fromId: row.id,
      toId: mode === 'merge' ? target?.id : '',
      reason: reason.trim(),
    })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setDone(r.message)
    reset()
    router.refresh()
  }

  async function withdraw() {
    if (open === null) return
    setBusy(true)
    const r = await cancelApproval(open.id)
    setBusy(false)
    if (!r.ok) setError(r.error)
    else router.refresh()
  }

  // ── already closed: the row is a signpost now, not a master ───────────
  if (row.status === 'merged' || row.status === 'discarded') return null

  return (
    <section className={cardCls}>
      <h3 className={sectionHeadCls}>Closing this {noun}</h3>

      {done !== null && (
        <div className="mt-3">
          <SaveAck
            headline={done}
            sub={`${row.code} · ${row.name}`}
            actions={[{ href: tabHref('owner', 'approvals'), label: 'See the approvals queue' }]}
          />
        </div>
      )}

      {open !== null ? (
        <div className="mt-3 space-y-3">
          <Honesty verdict="With the owner">
            A {open.kind} request is already open on this {noun}
            {open.requested_by === null ? '' : `, raised by ${open.requested_by}`} — “{open.reason}”. Nothing
            has changed yet, and a second request would be a second answer to one question.
          </Honesty>
          {canRequest && (
            <button type="button" onClick={withdraw} disabled={busy} className={btnGhostCls}>
              Withdraw the request
            </button>
          )}
        </div>
      ) : !canRequest ? null : mode === 'none' ? (
        <>
          <p className="mt-2 text-sm text-stone-600">
            Two ways to close a {noun}, and they mean different things.{' '}
            <span className="font-medium text-stone-800">Retiring</span> it — on the form above — says we
            stopped buying it, and leaves everything it touched exactly where it is.{' '}
            <span className="font-medium text-stone-800">Discarding</span> says it was never real.{' '}
            <span className="font-medium text-stone-800">Merging</span> says look over there instead, and
            moves every row that mentions it. Both of those need the owner.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setMode('merge')} className={btnGhostCls}>
              Merge into…
            </button>
            <button type="button" onClick={() => setMode('discard')} className={btnGhostCls}>
              Discard
            </button>
          </div>
        </>
      ) : (
        <div className="mt-3 space-y-4">
          {mode === 'merge' && (
            <div>
              <span className={fieldLabelCls}>Which {noun} survives?</span>
              {target === null ? (
                <>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`code or name — the ${noun} everything should point at`}
                    className={inputCls}
                    autoFocus
                  />
                  {shownHits.length > 0 && (
                    <ul className="mt-1 divide-y divide-rule-soft rounded-xl border border-rule bg-white">
                      {shownHits.map((h) => (
                        <li key={h.id}>
                          <button
                            type="button"
                            onClick={() => setTarget(h)}
                            className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50"
                          >
                            <span className={codeCls}>{h.code}</span>
                            <span className="truncate text-stone-800">{h.name}</span>
                            {h.units !== '' && (
                              <span className="ml-auto shrink-0 font-mono text-[11px] text-stone-400">{h.units}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm">
                  <span className={codeCls}>{target.code}</span>
                  <span className="text-stone-800">{target.name}</span>
                  <button type="button" onClick={() => setTarget(null)} className="text-stone-500 underline">
                    change
                  </button>
                </div>
              )}
            </div>
          )}

          {previewError !== null && (
            <Honesty verdict="Cannot be asked" level="alarm">
              {previewError}
            </Honesty>
          )}

          {preview !== null && <PreviewPanel p={preview} noun={noun} />}

          {preview !== null && (
            <>
              <label className="block">
                <span className={fieldLabelCls}>Why? (required)</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    mode === 'discard'
                      ? 'e.g. typed twice while setting up — this one was never bought'
                      : 'e.g. the same spray bottle under two codes'
                  }
                  className={inputCls}
                  maxLength={300}
                />
                <span className="mt-1 block text-xs text-stone-500">
                  The owner is being asked to approve something that will leave nothing behind to explain
                  itself. This sentence is the only account of why anyone will ever have.
                </span>
              </label>

              {error !== null && (
                <Honesty verdict="Not sent" level="alarm">
                  {error}
                </Honesty>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || reason.trim() === '' || !preview.wouldApply}
                  className={btnCls}
                >
                  {busy ? 'Sending…' : 'Ask the owner'}
                </button>
                <button type="button" onClick={reset} className={btnGhostCls}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {preview === null && previewError === null && mode === 'merge' && (
            <p className="text-sm text-stone-500">Pick the {noun} that survives to see what would move.</p>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * EXACTLY WHAT MOVES AND EXACTLY WHAT CHANGES.
 *
 * The reference counts come from `reference_counts`, which discovers them from
 * pg_constraint — items are pointed at by thirteen tables through four
 * differently-named columns, and a hand-written list would have missed one.
 * That is the hand-maintained-copy fault in the one place where it destroys
 * rather than merely misleads.
 */
function PreviewPanel({ p, noun }: { p: Preview; noun: string }) {
  const blocked = p.checks.filter((c) => !c.ok)
  return (
    <div className="space-y-3 rounded-xl border border-rule bg-stone-50 p-3">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
          {p.kind === 'discard' ? 'What points at it' : 'What would move'}
        </div>
        {p.refs.length === 0 ? (
          <p className="mt-1 text-sm text-stone-600">
            Nothing anywhere mentions this {noun} — no bill, no count, no recipe, no correction.
          </p>
        ) : (
          <div className="mt-1.5 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Table</th>
                  <th className={thCls}>Column</th>
                  <th className={thNumCls}>Rows</th>
                </tr>
              </thead>
              <tbody>
                {p.refs.map((r) => (
                  <tr key={`${r.referencing_table}.${r.referencing_column}`} className={trCls}>
                    <td className={`${tdCls} font-mono text-[12px]`}>
                      {r.referencing_table}
                      {/* SAID, NOT DEDUCED. "items: 1" on an item's own preview
                          is a merge pointer — the thing that keeps an older
                          code resolving here — and reads as a bill to anyone
                          who does not know the schema. */}
                      {r.pointer && (
                        <span className="ml-1.5 font-sans text-[11px] font-medium text-violet-700">
                          merge pointer
                        </span>
                      )}
                    </td>
                    <td className={`${tdCls} font-mono text-[12px] text-stone-500`}>{r.referencing_column}</td>
                    <td className={tdNumCls}>{r.n}</td>
                  </tr>
                ))}
                <tr className={trCls}>
                  <td className={`${tdCls} font-medium`} colSpan={2}>
                    {p.kind === 'discard' ? 'Total pointing at it' : `Total moving to ${p.to?.code}`}
                  </td>
                  <td className={`${tdNumCls} font-semibold`}>{p.totalRefs}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {p.refs.some((r) => r.pointer) && (
        <p className="text-[13px] text-stone-600">
          A <span className="font-medium text-violet-700">merge pointer</span> is not history — it is an
          older code that resolves here, so that looking it up still answers. Merging carries those
          pointers along with everything else; they end up aimed at whichever code survives.
        </p>
      )}

      {p.cost !== null && p.to !== null && (
        <p className="text-sm text-stone-700">
          <span className="font-medium">{p.to.code}</span>’s weighted average{' '}
          {p.cost.before === null ? (
            <>starts at <span className="font-mono">₹{p.cost.after}</span> — it has never been bought on its own.</>
          ) : p.cost.before === p.cost.after ? (
            <>stays at <span className="font-mono">₹{p.cost.before}</span>.</>
          ) : (
            <>
              {Number(p.cost.after) < Number(p.cost.before) ? 'falls' : 'rises'} from{' '}
              <span className="font-mono">₹{p.cost.before}</span> to{' '}
              <span className="font-mono">₹{p.cost.after}</span>.
            </>
          )}
        </p>
      )}

      <ul className="space-y-1">
        {p.checks.map((c) => (
          <li key={c.label} className="flex items-baseline gap-2 text-sm">
            <span className={c.ok ? 'text-emerald-700' : 'text-red-700'}>{c.ok ? '✓' : '✗'}</span>
            <span>
              <span className={c.ok ? 'text-stone-700' : 'font-medium text-red-800'}>{c.label}</span>
              <span className="text-stone-500"> — {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {blocked.length > 0 && (
        <Honesty verdict="Cannot be applied" level="alarm">
          {blocked[0].detail}. The database refuses this too, under a lock, at the moment of applying — so
          there is nothing to ask the owner for until it is sorted out.
        </Honesty>
      )}
    </div>
  )
}

/** What a closed row says afterwards. A merged or discarded code stays
 *  RESOLVABLE forever: looking up HKP-024 tells you it became HKP-015, and
 *  that is what makes closing one safe to do at all. */
export function ClosedNote({
  status,
  becameHref,
  becameCode,
  becameName,
}: {
  status: string
  becameHref?: string
  becameCode?: string | null
  becameName?: string | null
}) {
  if (status === 'merged') {
    return (
      <Honesty verdict="Merged">
        Everything that mentioned this now points at{' '}
        {becameHref !== undefined && becameCode ? (
          <Link href={becameHref} className="font-semibold underline underline-offset-2">
            {becameCode} {becameName}
          </Link>
        ) : (
          'another code'
        )}
        . This code stays here so the old one still resolves — nothing that was ever written down became
        unreadable.
      </Honesty>
    )
  }
  if (status === 'discarded') {
    return (
      <Honesty verdict="Discarded">
        This was never real — nothing pointed at it when it was closed. It stays on the list so the code
        still resolves rather than turning into a gap somebody re-uses.
      </Honesty>
    )
  }
  return null
}
