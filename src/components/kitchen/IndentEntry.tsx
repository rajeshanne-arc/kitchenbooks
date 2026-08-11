'use client'

// The chef's ask. An indent records what the section WANTS from the store
// — item lines with quantities, no costs anywhere. The store issues
// against it; asked vs given (the gap) lives on the indent's page.

import { useState } from 'react'
import Link from 'next/link'
import type { IssuableItemHit, SaveIndentResult, Section } from '@/lib/types'
import { saveIndent } from '@/server/kitchen-actions'
import { parseQty } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls } from '@/components/ui'
import IssueItemPicker from '@/components/store/IssueItemPicker'
import { useLang } from '@/components/useLang'

type Line = { key: number; item: IssuableItemHit | null; qty: string }
const newLine = (key: number): Line => ({ key, item: null, qty: '' })
const cleanQty = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function IndentEntry({ sections }: { sections: Section[] }) {
  const { label } = useLang()
  const [date, setDate] = useState(todayLocal)
  const [sectionId, setSectionId] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveIndentResult, { ok: true }> | null>(null)

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
  const canSave = !saving && sectionId !== '' && lines.length > 0 && lines.every(lineReady)

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveIndent({
        date,
        sectionId,
        note: note.trim(),
        lines: lines.map((l) => ({ itemId: (l.item as IssuableItemHit).id, qty: l.qty.trim() })),
      })
      if (res.ok) setSaved(res)
      else setError(res.error)
    } catch {
      setError('Could not reach the server — the indent was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  function startAnother() {
    setSaved(null)
    setSectionId('')
    setNote('')
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
    setDate(todayLocal())
  }

  if (saved !== null) {
    return (
      <section className={cardCls}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
            <svg className="h-5 w-5 text-emerald-700" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M4 10.5 8.5 15 16 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h2 className="text-lg font-bold text-stone-900">Indent open — {saved.indent.section_name}</h2>
            <p className="text-sm text-stone-500">
              {fmtDate(saved.indent.indent_date)} · {saved.indent.line_count}{' '}
              {saved.indent.line_count === 1 ? 'item' : 'items'} · waiting for the store
            </p>
          </div>
        </div>
        <ul className="mt-4 divide-y divide-rule-soft border-t border-stone-100">
          {saved.lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate text-[15px] text-stone-900">{l.item_name}</span>
              <span className="shrink-0 text-sm text-stone-500">
                {l.qty_requested} {l.purchase_unit}
              </span>
            </li>
          ))}
        </ul>
        <Link
          href={`/kitchen/indent/${saved.indent.id}`}
          className="mt-3 block text-center text-sm font-medium text-emerald-700 hover:underline"
        >
          Open the indent — asked vs given lives there →
        </Link>
        <button
          type="button"
          onClick={startAnother}
          className="mt-2 w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          New indent
        </button>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
          <label className="block">
            <span className={fieldLabelCls}>{label('date')}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
          </label>
          <div>
            <span className={fieldLabelCls}>{label('section')}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSectionId(s.id)}
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
      </section>

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
