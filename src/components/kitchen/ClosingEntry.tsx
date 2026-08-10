'use client'

// The itemized closing. The chef lists what the section still holds —
// raw items, sub batches, plated dishes — with QUANTITIES only; every
// line's cost is frozen server-side at save and the header closing_value
// becomes the SUM of the lines. Food cost keeps reading the header.
// Today's productions are one-tap suggestions: what was made today is
// what's most likely still on the shelf tonight. Zero lines is a real
// closing — an empty section is information. Latest filing per
// (section, date) wins; corrections wear the marker.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { KitchenComponentHit, ProductionRow, SaveItemizedClosingResult, Section } from '@/lib/types'
import { saveItemizedClosing } from '@/server/kitchen-actions'
import { formatMoneyString, parseQty } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls } from '@/components/ui'
import KitchenComponentPicker from './KitchenComponentPicker'
import { useLang } from '@/components/useLang'

type Line = { key: number; component: KitchenComponentHit | null; qty: string }
const newLine = (key: number): Line => ({ key, component: null, qty: '' })
const cleanQty = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function ClosingEntry({
  sections,
  todaysProductions,
}: {
  sections: Section[]
  todaysProductions: ProductionRow[]
}) {
  const router = useRouter()
  const { label } = useLang()
  const [date, setDate] = useState(todayLocal)
  const [sectionId, setSectionId] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveItemizedClosingResult, { ok: true }> | null>(null)

  const patchLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [newLine(nextKey)] : ls.filter((l) => l.key !== key)))

  const filled = lines.filter((l) => l.component !== null || l.qty.trim() !== '')
  const lineOk = (l: Line) => l.component !== null && parseQty(l.qty.trim()) !== null && Number(l.qty) > 0
  const canSave = !saving && sectionId !== '' && filled.every(lineOk)
  const isEmptyClosing = filled.length === 0

  const suggestions =
    sectionId === ''
      ? []
      : todaysProductions.filter(
          (p) =>
            p.section_id === sectionId &&
            !lines.some((l) => l.component?.kind === 'sub' && l.component.id === p.recipe_id),
        )

  function addSuggestion(p: ProductionRow) {
    const hit: KitchenComponentHit = {
      kind: 'sub',
      id: p.recipe_id,
      code: p.recipe_code,
      name: p.recipe_name,
      unit_name: p.output_unit,
      has_cost: true,
    }
    setLines((ls) => {
      const empty = ls.findIndex((l) => l.component === null && l.qty.trim() === '')
      const line = { key: nextKey, component: hit, qty: p.output_qty }
      if (empty === -1) return [...ls, line]
      const copy = [...ls]
      copy[empty] = line
      return copy
    })
    setNextKey((k) => k + 1)
  }

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveItemizedClosing({
        date,
        sectionId,
        note: note.trim(),
        lines: filled.map((l) => {
          const c = l.component as KitchenComponentHit
          return { kind: c.kind, id: c.id, qty: l.qty.trim() }
        }),
      })
      if (res.ok) {
        setSaved(res)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the closing was not saved. Please retry.')
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
  }

  if (saved !== null) {
    const c = saved.closing
    return (
      <section className={cardCls}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-stone-900">
            {c.section_name} closed — {formatMoneyString(c.closing_value)}
          </h2>
          {c.filings > 1 && (
            <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              corrected ×{c.filings - 1}
            </span>
          )}
        </div>
        <p className="text-sm text-stone-500">{fmtDate(c.close_date)} · latest filing wins</p>
        {saved.lines.length === 0 ? (
          <p className="mt-3 text-sm text-stone-600">Empty closing — the section holds nothing tonight. That is information.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-100">
            {saved.lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] text-stone-900">{l.component_name}</span>
                  <span className="block text-xs text-stone-500">
                    {l.qty} {l.unit} × {formatMoneyString(l.unit_cost)} <span className="uppercase">({l.kind})</span>
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-sm font-semibold text-stone-900">
                  {formatMoneyString(l.value)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-stone-400">costs frozen at save · header = sum of lines · kitchen_closing_current</p>
        <button
          type="button"
          onClick={startAnother}
          className="mt-3 w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          Close another section
        </button>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>{label('closing_title')}</h2>
          <span className="text-xs text-stone-400">latest per section wins · kitchen_closing_current</span>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-[11rem_1fr]">
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

      {suggestions.length > 0 && (
        <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-sky-800">Made today — still on the shelf?</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addSuggestion(p)}
                className="rounded-full border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-800 hover:border-sky-500"
              >
                ＋ {p.recipe_name} · {p.output_qty} {p.output_unit}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>What the section still holds</h2>
        <div className="mt-1 divide-y divide-stone-100">
          {lines.map((line, i) => (
            <div key={line.key} className="space-y-2 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <KitchenComponentPicker
                    value={line.component}
                    onPick={(hit) => patchLine(line.key, { component: hit })}
                    onClear={() => patchLine(line.key, { component: null })}
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
                {line.component !== null && <span className="text-sm text-stone-500">{line.component.unit_name}</span>}
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
        <p className="mt-2 text-xs text-stone-400">
          Quantities only — every cost is frozen from the live books at save. No prices to type, none shown.
        </p>
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
        {saving ? label('saving') : isEmptyClosing ? 'Save empty closing (₹0)' : label('save')}
      </button>
      {isEmptyClosing && (
        <p className="text-center text-xs text-stone-400">Zero is a real closing — an empty section is information.</p>
      )}
    </div>
  )
}
