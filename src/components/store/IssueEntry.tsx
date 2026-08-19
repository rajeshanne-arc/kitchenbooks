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
import type {
  IndentPrefill,
  IndentRow,
  IssuableItemHit,
  ItemSuggestion,
  SaveIssueInput,
  SaveIssueResult,
  SaveReturnInput,
  SaveReturnResult,
  Section,
} from '@/lib/types'
import { saveIssue, saveReturn } from '@/server/store-actions'
import { parseQty, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
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
import SaveAck from '@/components/SaveAck'
import IssueItemPicker from './IssueItemPicker'
import { useLang } from '@/components/useLang'
import { useBusinessToday } from '@/components/BusinessDay'

type Line = {
  key: number
  item: IssuableItemHit | null
  qty: string
  note: string
  /** PER LINE on the way back. Two things go back on one trip for two reasons. */
  reason: string
  /** what a normal issue of this item looks like, from section_frequent_items.
   *  Shown beside the box and NEVER written into it. */
  typical: string | null
}
const newLine = (key: number): Line => ({ key, item: null, qty: '', note: '', reason: '', typical: null })
const cleanQty = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

const prefillLines = (p: IndentPrefill, startKey: number): Line[] =>
  p.lines.map((l, i) => ({ ...newLine(startKey + i), item: l.item, qty: l.qty }))

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
  const businessToday = useBusinessToday()
  const [issueDate, setIssueDate] = useState(businessToday)
  const [direction, setDirection] = useState<Direction>('out')
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
  // WHAT THIS DEPARTMENT TAKES — the Issues sheet's habit, restored.
  //
  // The sheet filled the last ten days' items for a department, most frequent
  // first, and the app lost it: every issue started from a blank typeahead
  // over 300-odd items. section_frequent_items answers it, and it answers for
  // BOTH directions — you cannot return what was never issued, so the same
  // list is the right scope coming back as going out.
  //
  // Ranked by the server. Fetched per department, keyed by the department it
  // was fetched for, so a stale batch can never be shown against another one.
  const [frequent, setFrequent] = useState<{ sectionId: string; rows: ItemSuggestion[] } | null>(null)
  useEffect(() => {
    if (sectionId === '') return
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 10_000)
    fetch(`/api/items/frequent?section=${sectionId}`, { signal: ctl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ItemSuggestion[]) => {
        if (!ctl.signal.aborted) setFrequent({ sectionId, rows })
      })
      .catch(() => {
        /* suggestions are a courtesy; the search underneath still works */
      })
      .finally(() => clearTimeout(timer))
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
  }, [sectionId])
  const frequentRows = frequent?.sectionId === sectionId ? frequent.rows : []
  const sectionName = sections.find((x) => x.id === sectionId)?.name ?? ''

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
    (direction === 'out' || lines.every((l) => l.reason !== ''))

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    // Two shapes, because they are two events. An issue has no reason — the
    // reason it went out is the indent, or the shift. A return does.
    const movedLines = lines.map((l) => ({
      itemId: (l.item as IssuableItemHit).id,
      qty: l.qty.trim(),
      note: l.note.trim(),
    }))
    const returnedLines = lines.map((l, i) => ({ ...movedLines[i], reason: l.reason }))
    try {
      if (direction === 'back') {
        const payload: SaveReturnInput = {
          returnDate: issueDate,
          sectionId,
          session,
          lines: returnedLines,
        }
        const res = await saveReturn(payload)
        if (res.ok) {
          setSaved({ kind: 'back', res })
          resetForNext()
        } else setError(res.error)
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
        if (res.ok) {
          setSaved({ kind: 'out', res })
          resetForNext()
        } else setError(res.error)
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

  /** RESET FOR THE NEXT ENTRY, KEEPING WHAT CARRIES.
   *
   *  The DATE carries. A store manager catching up on yesterday files several
   *  issues for that day, and snapping back to today would silently re-date
   *  every one after the first — the same class of quiet wrongness as the
   *  session default.
   *
   *  The DEPARTMENT clears: it is the question just answered, and the next
   *  issue is usually to somewhere else. The SESSION carries, because a shift
   *  is the frame you are working inside rather than a per-entry answer — and
   *  it is on screen, chosen a minute ago by a person, not supplied by a
   *  column default. */
  function resetForNext() {
    setIndent(null)
    setSectionId('')
    setCateringId('')
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
  }

  return (
    <div className="space-y-4">
      {saved !== null && <IssueAck saved={saved} onDismiss={() => setSaved(null)} />}
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

        {/* REASON MOVED TO THE LINE — it used to be one chip row here, for the
            whole trip. A tray of gravy that was never needed and a crate of
            onions that turned come back together and are two different facts;
            one shared reason made one of them false. This block is only left
            to say so when the list is empty and nothing could be picked. */}
        {direction === 'back' && returnReasons.length === 0 && (
          <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No return reasons are set up yet — you can still type one on each line, and it will wait for an
            owner in Settings → Lists.
          </p>
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
                {direction === 'back' && <th className={`${thCls} w-[9rem]`}>Reason</th>}
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
                      suggestions={frequentRows}
                      suggestLabel={
                        direction === 'back'
                          ? `${sectionName} was issued these`
                          : `${sectionName} usually takes`
                      }
                      /* the typical quantity is REMEMBERED, not written: it
                         renders beside the box below and the box stays the
                         person's own answer */
                      onPick={(hit, sug) =>
                        patchLine(line.key, { item: hit, typical: sug?.typical_qty ?? null })
                      }
                      onClear={() => patchLine(line.key, { item: null, typical: null })}
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
                    {/* A HINT, never a prefill. The closing form's ruling
                        applies: a quantity nobody counted looks exactly like
                        one somebody did, and this one would be an average. */}
                    {line.typical !== null && line.qty === '' && (
                      <span className="mt-0.5 block text-right font-mono text-[10px] tabular-nums text-stone-400">
                        usually {line.typical}
                      </span>
                    )}
                  </td>
                  <td className="border-b border-rule-soft px-2 py-1.5 text-sm text-stone-500">
                    {line.item?.unit_name ?? '—'}
                  </td>
                  <td className="border-b border-rule-soft px-2 py-1.5 text-right font-mono text-sm tabular-nums text-stone-500">
                    {line.item?.on_hand_qty ?? '—'}
                  </td>
                  {direction === 'back' && (
                    <td className="border-b border-rule-soft px-1 py-1.5">
                      {/* PER LINE, from the return_reason list — the same shape
                          the loss forms already use. */}
                      <select
                        aria-label={`Reason, line ${i + 1}`}
                        value={line.reason}
                        onChange={(e) => patchLine(line.key, { reason: e.target.value })}
                        className={selectCls}
                      >
                        <option value="">—</option>
                        {returnReasons.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
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

/**
 * What just happened, said in numbers, above a form that is already blank
 * for the next one. It replaces a full-screen reveal that hid the form until
 * somebody tapped "Enter another": a store manager issues several times a
 * morning, and a tap between every one is a tax on the most-used screen in
 * the app.
 *
 * NEGATIVE STOCK IS THE THING STILL MISSING. It is the loudest sentence in
 * this product — more issued than purchased on record means a bill was never
 * entered — and the moment it appears is the moment somebody can still go and
 * find that bill.
 */
function IssueAck({ saved, onDismiss }: { saved: Saved; onDismiss: () => void }) {
  const back = saved.kind === 'back'
  const doc = back ? saved.res.ret : saved.res.issue
  const date = back ? saved.res.ret.return_date : saved.res.issue.issue_date
  const value = back ? saved.res.ret.total_value : saved.res.issue.total_value
  const short = saved.res.stock.filter((s) => Number(s.on_hand_qty) < 0)

  return (
    <SaveAck
      onDismiss={onDismiss}
      headline={
        <>
          {doc.line_count} {doc.line_count === 1 ? 'item' : 'items'}{' '}
          {back ? 'back from' : 'to'} {doc.section_name} —{' '}
          <span className="tabular-nums">{formatMoneyString(value)}</span>
        </>
      }
      sub={
        <>
          {fmtDate(date)}
          {back && ` · ${saved.res.ret.reason}`}
          {!back && saved.res.issue.indent_id !== null && ' · indent marked issued'}
        </>
      }
      missing={
        short.length > 0
          ? [
              {
                level: 'alarm' as const,
                verdict: 'negative stock',
                text: (
                  <>
                    {short.map((s) => `${s.name} is at ${s.on_hand_qty} ${s.purchase_unit}`).join(', ')} — more has been
                    issued than the book says was ever bought. A bill is probably missing; enter it and this corrects
                    itself.
                  </>
                ),
              },
            ]
          : undefined
      }
      actions={[
        ...(!back && saved.res.issue.indent_id !== null
          ? [{ href: `/kitchen/indent/${saved.res.issue.indent_id}`, label: 'Asked vs given on the indent' }]
          : []),
        ...(!back ? [{ href: `/store/books/issues/${saved.res.issue.id}`, label: 'See it in the store log' }] : []),
      ]}
    >
      <ul className="divide-y divide-emerald-200/60 border-y border-emerald-200/60">
        {saved.res.lines.map((l) => {
          const now = saved.res.stock.find((s) => s.item_id === l.item_id)
          return (
            <li key={l.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 truncate text-stone-900">{l.item_name}</span>
              <span className="shrink-0 tabular-nums text-stone-600">
                {l.qty} {l.purchase_unit}
                {now !== undefined && (
                  <span className={Number(now.on_hand_qty) < 0 ? 'ml-2 font-semibold text-red-700' : 'ml-2 text-stone-400'}>
                    {now.on_hand_qty} left
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="mt-1.5 text-xs text-stone-500">stock read live from stock_on_hand</p>
    </SaveAck>
  )
}
