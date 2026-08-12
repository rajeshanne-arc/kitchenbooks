'use client'

// The store manager's core form. No costs on screen anywhere — unit_cost is
// snapshotted server-side at save; value appears only in the after-save
// reveal, together with remaining stock per issued item.
//
// Indents: arriving with ?indent= (or tapping a suggestion after picking a
// section) prefills the form from the ask. The issue records what was
// GIVEN — edit lines freely; the gap against the ask lives on the indent's
// page. Saving stamps issues.indent_id and marks the indent issued.
//
// DIRECTION. Stock moves both ways through this one form: OUT to a section,
// or BACK to the store when a section did not use it. Everything else about
// the form is identical — same sections, same items, same quantities — so a
// return is a toggle, not a second screen the store has to go find. A return
// is not a void: the trip out really happened and stays on record.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type {
  IndentPrefill,
  IndentRow,
  IssuableItemHit,
  SaveIssueInput,
  SaveIssueResult,
  SaveReturnInput,
  SaveReturnResult,
  Section,
} from '@/lib/types'
import { saveIssue, saveReturn } from '@/server/store-actions'
import { parseQty, formatMoneyString } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import {
  cardCls,
  dataTableCls,
  fieldLabelCls,
  numCls,
  sectionHeadCls,
  selectCls,
  thCls,
  thNumCls,
} from '@/components/ui'
import IssueItemPicker from './IssueItemPicker'
import { useLang } from '@/components/useLang'

type Line = { key: number; item: IssuableItemHit | null; qty: string; note: string }
const newLine = (key: number): Line => ({ key, item: null, qty: '', note: '' })
const cleanQty = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

const prefillLines = (p: IndentPrefill, startKey: number): Line[] =>
  p.lines.map((l, i) => ({ key: startKey + i, item: l.item, qty: l.qty, note: '' }))

type Direction = 'out' | 'back'

type Saved =
  | { kind: 'out'; res: Extract<SaveIssueResult, { ok: true }> }
  | { kind: 'back'; res: Extract<SaveReturnResult, { ok: true }> }

export default function IssueEntry({
  sections,
  sessions,
  cateringEvents,
  returnReasons,
  initialIndent = null,
}: {
  sections: Section[]
  /** the `session` list. NOTHING is preselected — see below. */
  sessions: string[]
  /** catering events an issue may be stamped to. catering_summary sums ONLY
   *  stamped issues, so an unstamped catering issue leaves that event's
   *  food cost at zero and its margin reading as the whole revenue. */
  cateringEvents: { id: string; name: string; event_date: string }[]
  returnReasons: string[]
  initialIndent?: IndentPrefill | null
}) {
  const [issueDate, setIssueDate] = useState(todayLocal)
  const [direction, setDirection] = useState<Direction>('out')
  const [reason, setReason] = useState('')
  // Deliberately BLANK. issues.session defaults to 'Morning' in the
  // database, and preselecting it here would reproduce exactly the silent
  // default that mislabelled the data: every evening issue quietly claiming
  // to be a morning one. An unanswered question stays unanswered until it
  // is answered, and the save refuses until then.
  const [session, setSession] = useState(initialIndent?.session ?? '')
  const [cateringId, setCateringId] = useState('')
  const [indent, setIndent] = useState<IndentPrefill | null>(initialIndent)
  const [sectionId, setSectionId] = useState(initialIndent?.section_id ?? '')
  const [lines, setLines] = useState<Line[]>(
    initialIndent !== null && initialIndent.lines.length > 0 ? prefillLines(initialIndent, 1) : [newLine(1)],
  )
  const [nextKey, setNextKey] = useState((initialIndent?.lines.length ?? 0) + 2)
  const [suggestions, setSuggestions] = useState<{
    sectionId: string
    session: string
    rows: IndentRow[]
  } | null>(null)
  const { label } = useLang()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)

  // An indent is a request to be GIVEN something; it has no meaning on the
  // way back, so turning the form around drops the stamp rather than
  // silently carrying it onto a return.
  function switchDirection(next: Direction) {
    if (next === direction) return
    setDirection(next)
    setError(null)
    if (next === 'back') setIndent(null)
  }

  // Picking a section (with no indent bound) surfaces that section's open
  // indents as one-tap suggestions — the most recent first, chooser if
  // several. Fetched per section; render shows only the matching batch.
  // DEPARTMENT + SESSION together pick out the one indent being filled.
  // A department alone can have a morning ask and an evening ask open at
  // once; asking for both narrows it to the request actually in hand, and
  // when exactly one matches it fills itself.
  // in-flight prefill, so a click that is still running is cancelled when
  // another starts or the form goes away
  const adoptCtl = useRef<AbortController | null>(null)
  useEffect(() => () => adoptCtl.current?.abort(), [])

  useEffect(() => {
    if (sectionId === '' || session === '' || indent !== null) return
    const ctl = new AbortController()
    fetch(`/api/indents?section=${sectionId}&session=${encodeURIComponent(session)}`, {
      signal: ctl.signal,
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: IndentRow[]) => {
        if (!ctl.signal.aborted) setSuggestions({ sectionId, session, rows })
      })
      .catch(() => {})
    return () => ctl.abort()
  }, [sectionId, session, indent])
  // Open indents are an offer to fill a request — meaningless on a return.
  const suggested =
    direction === 'out' &&
    indent === null &&
    suggestions?.sectionId === sectionId &&
    suggestions?.session === session
      ? suggestions.rows
      : []

  // ABORTED AND TIMED OUT, like every other fetch here. This one was
  // neither: it is called from a click rather than an effect, so it had no
  // cleanup, and a stalled request would stay pending until the browser
  // gave up on its own. A pending fetch is enough to stop a document ever
  // reaching idle — which is what a 45-second wait on this page looked like.
  async function adoptIndent(id: string) {
    adoptCtl.current?.abort()
    const ctl = new AbortController()
    adoptCtl.current = ctl
    const timer = setTimeout(() => ctl.abort(), 10_000)
    try {
      const res = await fetch(`/api/indents?id=${id}`, { cache: 'no-store', signal: ctl.signal })
      if (!res.ok) return
      const p = (await res.json()) as IndentPrefill
      setIndent(p)
      setSectionId(p.section_id)
      setSession(p.session)
      setLines(p.lines.length > 0 ? prefillLines(p, nextKey) : [newLine(nextKey)])
      setNextKey((k) => k + p.lines.length + 1)
    } catch {
      /* suggestion only — the plain form still works */
    } finally {
      clearTimeout(timer)
      if (adoptCtl.current === ctl) adoptCtl.current = null
    }
  }

  function dropIndent() {
    setIndent(null)
  }

  const patchLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) => {
    if (lines.length === 1) {
      setLines([newLine(nextKey)])
      setNextKey((k) => k + 1)
    } else {
      setLines((ls) => ls.filter((l) => l.key !== key))
    }
  }

  const lineReady = (l: Line) => {
    const q = parseQty(l.qty)
    return l.item !== null && q !== null && q > 0
  }
  const canSave =
    !saving &&
    sectionId !== '' &&
    lines.length > 0 &&
    lines.every(lineReady) &&
    session !== '' &&
    (direction === 'out' || reason !== '')

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    const movedLines = lines.map((l) => ({
      itemId: (l.item as IssuableItemHit).id,
      qty: l.qty.trim(),
      note: l.note.trim(),
    }))
    try {
      if (direction === 'back') {
        const payload: SaveReturnInput = {
          returnDate: issueDate,
          sectionId,
          session,
          reason,
          lines: movedLines,
        }
        const res = await saveReturn(payload)
        if (res.ok) setSaved({ kind: 'back', res })
        else setError(res.error)
      } else {
        const payload: SaveIssueInput = {
          issueDate,
          sectionId,
          session,
          lines: movedLines,
          ...(indent !== null ? { indentId: indent.id } : {}),
          ...(cateringId !== '' ? { cateringId } : {}),
        }
        const res = await saveIssue(payload)
        if (res.ok) setSaved({ kind: 'out', res })
        else setError(res.error)
      }
    } catch {
      setError(
        direction === 'back'
          ? 'Could not reach the server — the return was not saved. Please retry.'
          : 'Could not reach the server — the issue was not saved. Please retry.',
      )
    } finally {
      setSaving(false)
    }
  }

  function startAnother() {
    setSaved(null)
    setIndent(null)
    setSectionId('')
    setReason('')
    setCateringId('')
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
    setIssueDate(todayLocal())
  }

  if (saved !== null) {
    const back = saved.kind === 'back'
    const head = back
      ? {
          title: `Returned from ${saved.res.ret.section_name}`,
          sub: `${fmtDate(saved.res.ret.return_date)} · ${saved.res.ret.line_count} ${
            saved.res.ret.line_count === 1 ? 'item' : 'items'
          } · ${saved.res.ret.reason}`,
        }
      : {
          title: `Issued to ${saved.res.issue.section_name}`,
          sub: `${fmtDate(saved.res.issue.issue_date)} · ${saved.res.issue.line_count} ${
            saved.res.issue.line_count === 1 ? 'item' : 'items'
          }${saved.res.issue.indent_id !== null ? ' · indent marked issued' : ''}`,
        }
    const savedLines = saved.res.lines
    const stock = saved.res.stock
    const totalValue = back ? saved.res.ret.total_value : saved.res.issue.total_value
    return (
      <div className="space-y-4">
        <section className={cardCls}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-5 w-5 text-emerald-700" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path d="M4 10.5 8.5 15 16 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <h2 className="text-lg font-bold text-stone-900">{head.title}</h2>
              <p className="text-sm text-stone-500">{head.sub}</p>
            </div>
          </div>
          <ul className="mt-4 divide-y divide-rule-soft border-t border-stone-100">
            {savedLines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate text-[15px] text-stone-900">{l.item_name}</span>
                <span className="shrink-0 text-sm text-stone-500">
                  {l.qty} {l.purchase_unit}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-stone-100 pt-3">
            <span className="text-sm font-medium text-stone-500">
              {back ? 'Value returned' : 'Total value'}
            </span>
            <span className="text-2xl font-bold tabular-nums tracking-tight text-stone-900">
              {formatMoneyString(totalValue)}
            </span>
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-emerald-800">
            {back ? 'Stock back in the store' : 'Stock remaining'}
          </h3>
          <ul className="mt-2 space-y-1.5">
            {stock.map((s) => (
              <li key={s.item_id} className="flex items-center justify-between gap-3 text-[15px] text-stone-900">
                <span className="min-w-0 truncate">{s.name}</span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {s.on_hand_qty} {s.purchase_unit} left
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-500">read live from stock_on_hand</p>
        </section>

        <button
          type="button"
          onClick={startAnother}
          className="w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          {back ? 'Enter another movement' : 'Enter another issue'}
        </button>
        {!back && saved.res.issue.indent_id !== null && (
          <Link
            href={`/kitchen/indent/${saved.res.issue.indent_id}`}
            className="block text-center text-sm font-medium text-emerald-700 hover:underline"
          >
            See asked vs given on the indent →
          </Link>
        )}
        {!back && (
          <Link
            href={`/store/books/issues/${saved.res.issue.id}`}
            className="block text-center text-sm font-medium text-emerald-700 hover:underline"
          >
            See it in the store log →
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Which way the stock is moving. Two taps wide, stated in the store's
          own words rather than "issue"/"return" — the direction is the thing
          being chosen, so it sits above everything it changes. */}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Direction of the movement">
        {(
          [
            { key: 'out', title: 'Out to section', sub: 'store → kitchen' },
            { key: 'back', title: 'Back to store', sub: 'kitchen → store' },
          ] as const
        ).map((d) => (
          <button
            key={d.key}
            type="button"
            aria-pressed={direction === d.key}
            onClick={() => switchDirection(d.key)}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
              direction === d.key
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
            }`}
          >
            <span className="block text-[15px] font-semibold">{d.title}</span>
            <span className={`block text-xs ${direction === d.key ? 'text-emerald-100' : 'text-stone-500'}`}>
              {d.sub}
            </span>
          </button>
        ))}
      </div>

      {direction === 'back' && (
        <p className="rounded-xl border border-rule bg-stone-50 px-3 py-2 text-xs text-stone-600">
          A return is not a correction. The issue really happened and stays on record — this books the stock
          back into the store and takes the value off the section&apos;s consumption.
        </p>
      )}

      {indent !== null && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-sky-300 bg-sky-50 p-3">
          <span className="min-w-0 text-sm text-sky-900">
            Filling <span className="font-semibold">{indent.section_name}</span>&apos;s indent of{' '}
            {fmtDate(indent.indent_date)} — edit lines freely; the gap stays on record.
          </span>
          <button
            type="button"
            onClick={dropIndent}
            className="shrink-0 rounded-lg border border-sky-300 bg-white px-2 py-1 text-xs font-medium text-sky-800 hover:border-sky-500"
          >
            drop indent
          </button>
        </div>
      )}

      <section className={cardCls}>
        <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
          <label className="block">
            <span className={fieldLabelCls}>{label('date')}</span>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className={`${numCls} w-full`}
            />
          </label>
          <div>
            <span className={fieldLabelCls}>{label('section')}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    if (indent !== null && s.id !== indent.section_id) setIndent(null)
                    setSectionId(s.id)
                  }}
                  className={`rounded-xl border px-2 py-2 text-sm font-medium ${
                    sectionId === s.id
                      ? 'border-emerald-700 bg-emerald-700 text-white'
                      : 'border-stone-200 bg-white text-stone-700 hover:border-emerald-400'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* Beside the department, because together they name the one ask
            being answered. Nothing is preselected on purpose. */}
        <div className="mt-4">
          <span className={fieldLabelCls}>Session</span>
          {sessions.length === 0 ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No sessions are set up — add them in Settings → Lists.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sessions.map((sn) => (
                <button
                  key={sn}
                  type="button"
                  aria-pressed={session === sn}
                  onClick={() => setSession(sn)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-medium ${
                    session === sn
                      ? 'border-emerald-700 bg-emerald-700 text-white'
                      : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
                  }`}
                >
                  {sn}
                </button>
              ))}
            </div>
          )}
          {session === '' && sectionId !== '' && (
            <p className="mt-1.5 text-xs text-stone-600">
              Pick the session before saving — it is not assumed.
            </p>
          )}
        </div>

        {/* A catering session asks WHICH event. Without the stamp the event's
            food cost stays zero and its margin reads as the whole revenue —
            so the question is asked here, where the stock is actually going
            out, rather than reconstructed later. */}
        {direction === 'out' && session.toLowerCase() === 'catering' && (
          <div className="mt-4">
            <span className={fieldLabelCls}>Which event?</span>
            {cateringEvents.length === 0 ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                No catering event on file yet — create it under Sales → Catering first, or this stock will not
                reach any event&apos;s cost.
              </p>
            ) : (
              <>
                <select
                  value={cateringId}
                  onChange={(e) => setCateringId(e.target.value)}
                  className={selectCls}
                >
                  <option value="">— not for an event —</option>
                  {cateringEvents.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {fmtDate(c.event_date)}
                    </option>
                  ))}
                </select>
                {cateringId === '' && (
                  <p className="mt-1.5 text-xs text-amber-900">
                    Unstamped, this stock costs nobody — the event&apos;s margin will read as its whole revenue.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {direction === 'back' && (
          <div className="mt-4">
            <span className={fieldLabelCls}>Why is it coming back?</span>
            {returnReasons.length === 0 ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                No return reasons are set up yet — add them in Settings → Lists before recording a return.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {returnReasons.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={reason === r}
                    onClick={() => setReason(r)}
                    className={`rounded-full border px-3 py-2 text-sm font-medium ${
                      reason === r
                        ? 'border-emerald-700 bg-emerald-700 text-white'
                        : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {suggested.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-900">
              This section has {suggested.length === 1 ? 'an open indent' : `${suggested.length} open indents`} — fill
              from it?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suggested.slice(0, 3).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void adoptIndent(s.id)}
                  className="rounded-full border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:border-amber-600"
                >
                  {fmtDate(s.indent_date)} · {s.session} · {s.line_count}{' '}
                  {s.line_count === 1 ? 'item' : 'items'}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* A TABLE, not a stack of cards. Entering ten lines means reading down
          one column — every quantity in the same place, every unit beside it —
          and tab moves across a row then down to the next, the way the sheet
          did. Stacked cards make the eye hunt for the same field ten times. */}
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>{direction === 'back' ? 'Items coming back' : 'Items issued'}</h2>
        <div className="mt-2 overflow-x-auto">
          <table className={dataTableCls}>
            <thead>
              <tr>
                <th className={`${thCls} w-[38%]`}>Item</th>
                <th className={`${thNumCls} w-[6.5rem]`}>Qty</th>
                <th className={`${thCls} w-[5rem]`}>Unit</th>
                <th className={`${thNumCls} w-[6rem]`}>On hand</th>
                <th className={thCls}>Note</th>
                <th className={`${thCls} w-8`}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={line.key} className="h-12 align-middle">
                  <td className="border-b border-rule-soft px-1 py-1.5">
                    <IssueItemPicker
                      value={line.item}
                      onPick={(hit) => patchLine(line.key, { item: hit })}
                      onClear={() => patchLine(line.key, { item: null })}
                    />
                  </td>
                  <td className="border-b border-rule-soft px-1 py-1.5">
                    <input
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`Quantity, line ${i + 1}`}
                      value={line.qty}
                      onChange={(e) => patchLine(line.key, { qty: cleanQty(e.target.value) })}
                      className={`${numCls} w-full text-right font-mono tabular-nums`}
                    />
                  </td>
                  <td className="border-b border-rule-soft px-2 py-1.5 text-sm text-stone-500">
                    {line.item?.unit_name ?? '—'}
                  </td>
                  <td className="border-b border-rule-soft px-2 py-1.5 text-right font-mono text-sm tabular-nums text-stone-500">
                    {line.item?.on_hand_qty ?? '—'}
                  </td>
                  <td className="border-b border-rule-soft px-1 py-1.5">
                    <input
                      placeholder="optional"
                      aria-label={`Note, line ${i + 1}`}
                      value={line.note}
                      onChange={(e) => patchLine(line.key, { note: e.target.value })}
                      maxLength={200}
                      className={`${numCls} w-full`}
                    />
                  </td>
                  <td className="border-b border-rule-soft px-1 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      aria-label={`Remove line ${i + 1}`}
                      className="rounded-md p-1 text-stone-300 hover:bg-stone-100 hover:text-stone-600"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-3 w-full rounded-xl border border-dashed border-stone-300 py-2.5 text-sm font-medium text-stone-500 hover:border-emerald-400 hover:text-emerald-700"
        >
          ＋ Add item
        </button>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        className="w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {saving ? label('saving') : direction === 'back' ? 'Save return' : label('save_issue')}
      </button>
      <p className="text-center text-xs text-stone-400">
        Costs are attached automatically from purchase history — nothing to type.
      </p>
    </div>
  )
}
