'use client'

// The chef's ask. An indent records what the section WANTS from the store
// — item lines with quantities, no costs anywhere. The store issues
// against it; asked vs given (the gap) lives on the indent's page.

import { useEffect, useRef, useState } from 'react'
import type { IssuableItemHit, SaveIndentResult, Section } from '@/lib/types'
import { saveIndent } from '@/server/kitchen-actions'
import SaveAck from '@/components/SaveAck'
import { parseQty } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls } from '@/components/ui'
import IssueItemPicker from '@/components/store/IssueItemPicker'
import { useLang } from '@/components/useLang'
import { useBusinessToday } from '@/components/BusinessDay'

type Line = { key: number; item: IssuableItemHit | null; qty: string }
const newLine = (key: number): Line => ({ key, item: null, qty: '' })
const cleanQty = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function IndentEntry({
  sections,
  sessions,
}: {
  sections: Section[]
  /** the `session` list — an indent is for a SHIFT, not a day */
  sessions: string[]
}) {
  const businessToday = useBusinessToday()
  const { label } = useLang()
  const [date, setDate] = useState(businessToday)
  const refillCtl = useRef<AbortController | null>(null)
  useEffect(() => () => refillCtl.current?.abort(), [])
  const [sectionId, setSectionId] = useState('')
  const [session, setSession] = useState(sessions[0] ?? '')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveIndentResult, { ok: true }> | null>(null)
  const [refilling, setRefilling] = useState(false)
  const [refillNote, setRefillNote] = useState<string | null>(null)

  // Yesterday's list, back on the screen. A kitchen asks for nearly the same
  // things every evening, and retyping fifteen lines was the single biggest
  // daily cost in the product. It fills the form and stops — every quantity
  // is still editable, and nothing is saved until save is pressed.
  // aborted and timed out: a stalled request would leave the button spinning
  // and the document never idle
  async function refillFromLast() {
    if (sectionId === '' || session === '') return
    refillCtl.current?.abort()
    const ctl = new AbortController()
    refillCtl.current = ctl
    const timer = setTimeout(() => ctl.abort(), 10_000)
    setRefilling(true)
    setRefillNote(null)
    try {
      const res = await fetch(
        `/api/indents?last=1&section=${sectionId}&session=${encodeURIComponent(session)}`,
        { cache: 'no-store', signal: ctl.signal },
      )
      if (!res.ok) {
        setRefillNote('No earlier request for this department and session yet.')
        return
      }
      const p = (await res.json()) as {
        indent_date: string
        lines: { item: IssuableItemHit; qty: string }[]
      }
      if (p.lines.length === 0) {
        setRefillNote('The last request had no lines.')
        return
      }
      setLines(p.lines.map((l, i) => ({ key: nextKey + i, item: l.item, qty: l.qty })))
      setNextKey((k) => k + p.lines.length + 1)
      setRefillNote(`Filled from the request of ${fmtDate(p.indent_date)} — edit anything before saving.`)
    } catch {
      setRefillNote('Could not reach the server.')
    } finally {
      clearTimeout(timer)
      if (refillCtl.current === ctl) refillCtl.current = null
      setRefilling(false)
    }
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

  const lineReady = (l: Line) => l.item !== null && parseQty(l.qty) !== null && Number(l.qty) > 0
  const canSave =
    !saving && sectionId !== '' && session !== '' && lines.length > 0 && lines.every(lineReady)

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveIndent({
        date,
        sectionId,
        session,
        note: note.trim(),
        lines: lines.map((l) => ({ itemId: (l.item as IssuableItemHit).id, qty: l.qty.trim() })),
      })
      if (res.ok) {
        setSaved(res)
        resetForNext()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — the indent was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  /** Reset for the next entry, keeping what carries: the DATE and the
   *  SESSION stay — a chef raising the morning's requests raises them for one
   *  shift — and the DEPARTMENT clears, because a department already has an
   *  open ask once this is filed and the next request is somebody else's. */
  function resetForNext() {
    setSectionId('')
    setNote('')
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
  }

  return (
    <div className="space-y-4">
      {saved !== null && <IndentAck saved={saved} onDismiss={() => setSaved(null)} />}
      <section className={cardCls}>
        <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
          <label className="block">
            <span className={fieldLabelCls}>{label('date')}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
          </label>
          <div>
            <span className={fieldLabelCls}>Department</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSectionId(s.id)}
                  className={`rounded-xl border px-2 py-2 text-sm font-medium ${
                    sectionId === s.id
                      ? 'border-emerald-700 bg-emerald-700 text-white'
                      : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* An indent is for a SHIFT. The evening kitchen asks for different
            things than the morning one, and the store needs to know which
            ask it is filling. */}
        <div className="mt-4">
          <span className={fieldLabelCls}>Session</span>
          {sessions.length === 0 ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No sessions are set up — add them in Setup → Lists.
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
        </div>
      </section>

      {sectionId !== '' && session !== '' && (
        <div className="rounded-2xl border border-rule bg-stone-50 p-3">
          <button
            type="button"
            onClick={() => void refillFromLast()}
            disabled={refilling}
            className="w-full rounded-xl border border-dashed border-stone-300 py-2.5 text-sm font-medium text-stone-600 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50"
          >
            {refilling ? 'Fetching…' : '↻ Refill from last request'}
          </button>
          {refillNote !== null && <p className="mt-2 text-xs text-stone-600">{refillNote}</p>}
        </div>
      )}

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Items requested</h2>
        <div className="mt-1 divide-y divide-rule-soft">
          {lines.map((line, i) => (
            <div key={line.key} className="space-y-2 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <IssueItemPicker
                    value={line.item}
                    onPick={(hit) => patchLine(line.key, { item: hit })}
                    onClear={() => patchLine(line.key, { item: null })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  aria-label={`Remove line ${i + 1}`}
                  className="mt-1.5 shrink-0 rounded-md p-1 text-stone-300 hover:bg-stone-100 hover:text-stone-600"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  inputMode="decimal"
                  placeholder="Qty"
                  value={line.qty}
                  onChange={(e) => patchLine(line.key, { qty: cleanQty(e.target.value) })}
                  className={`${numCls} w-24`}
                />
                {line.item !== null && <span className="text-sm text-stone-500">{line.item.unit_name}</span>}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-3 w-full rounded-xl border border-dashed border-stone-300 py-2.5 text-sm font-medium text-stone-500 hover:border-emerald-400 hover:text-emerald-700"
        >
          ＋ {label('add_item')}
        </button>
        <label className="mt-3 block">
          <span className={fieldLabelCls}>{label('note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
        </label>
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
        {saving ? label('saving') : 'Save indent'}
      </button>
      <p className="text-center text-xs text-stone-400">
        The indent records what was asked; the issue records what was given. The gap between them stays visible.
      </p>
    </div>
  )
}

/**
 * An indent is a REQUEST, so the honest thing to say after saving one is that
 * nothing has been given yet — the gap it exists to measure does not have a
 * value until the store issues against it. That is a precondition, not a
 * shortage, and the indent page says the same thing in the same words.
 */
function IndentAck({
  saved,
  onDismiss,
}: {
  saved: Extract<SaveIndentResult, { ok: true }>
  onDismiss: () => void
}) {
  return (
    <SaveAck
      onDismiss={onDismiss}
      headline={
        <>
          {saved.indent.line_count} {saved.indent.line_count === 1 ? 'item' : 'items'} asked for —{' '}
          {saved.indent.section_name}
        </>
      }
      sub={`${fmtDate(saved.indent.indent_date)} · ${saved.indent.session} · open, waiting for the store`}
      missing={[
        {
          verdict: 'not issued yet',
          text: 'Nothing has been given against this request. Asked-vs-given is on the indent and stays blank until the store issues — an unfilled ask is not a shortage.',
        },
      ]}
      actions={[{ href: `/kitchen/indent/${saved.indent.id}`, label: 'Open the indent' }]}
    >
      <ul className="divide-y divide-emerald-200/60 border-y border-emerald-200/60">
        {saved.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0 truncate text-stone-900">{l.item_name}</span>
            <span className="shrink-0 tabular-nums text-stone-600">
              {l.qty_requested} {l.purchase_unit}
            </span>
          </li>
        ))}
      </ul>
    </SaveAck>
  )
}
