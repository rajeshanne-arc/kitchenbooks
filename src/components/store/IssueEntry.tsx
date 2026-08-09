'use client'

// The store manager's core form. No costs on screen anywhere — unit_cost is
// snapshotted server-side at save; value appears only in the after-save
// reveal, together with remaining stock per issued item.

import { useState } from 'react'
import Link from 'next/link'
import type { IssuableItemHit, SaveIssueInput, SaveIssueResult, Section } from '@/lib/types'
import { saveIssue } from '@/server/store-actions'
import { parseQty, formatMoneyString } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, numCls, sectionHeadCls } from '@/components/ui'
import IssueItemPicker from './IssueItemPicker'

type Line = { key: number; item: IssuableItemHit | null; qty: string }
const newLine = (key: number): Line => ({ key, item: null, qty: '' })
const cleanQty = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function IssueEntry({ sections }: { sections: Section[] }) {
  const [issueDate, setIssueDate] = useState(todayLocal)
  const [sectionId, setSectionId] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveIssueResult, { ok: true }> | null>(null)

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
  const canSave = !saving && sectionId !== '' && lines.length > 0 && lines.every(lineReady)

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    const payload: SaveIssueInput = {
      issueDate,
      sectionId,
      lines: lines.map((l) => ({ itemId: (l.item as IssuableItemHit).id, qty: l.qty.trim() })),
    }
    try {
      const res = await saveIssue(payload)
      if (res.ok) {
        setSaved(res)
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the issue was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  function startAnother() {
    setSaved(null)
    setSectionId('')
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
    setIssueDate(todayLocal())
  }

  if (saved !== null) {
    const { issue, lines: savedLines, stock } = saved
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
              <h2 className="text-lg font-bold text-stone-900">Issued to {issue.section_name}</h2>
              <p className="text-sm text-stone-500">
                {fmtDate(issue.issue_date)} · {issue.line_count} {issue.line_count === 1 ? 'item' : 'items'}
              </p>
            </div>
          </div>
          <ul className="mt-4 divide-y divide-stone-100 border-t border-stone-100">
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
            <span className="text-sm font-medium text-stone-500">Total value</span>
            <span className="text-2xl font-bold tabular-nums tracking-tight text-stone-900">
              {formatMoneyString(issue.total_value)}
            </span>
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-emerald-800">Stock remaining</h3>
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
          Enter another issue
        </button>
        <Link
          href={`/books/issues/${issue.id}`}
          className="block text-center text-sm font-medium text-emerald-700 hover:underline"
        >
          See it in the store log →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
          <label className="block">
            <span className={fieldLabelCls}>Date</span>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className={`${numCls} w-full`}
            />
          </label>
          <div>
            <span className={fieldLabelCls}>Section</span>
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
        <h2 className={sectionHeadCls}>Items issued</h2>
        <div className="mt-1 divide-y divide-stone-100">
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
        {saving ? 'Saving…' : 'Save issue'}
      </button>
      <p className="text-center text-xs text-stone-400">
        Costs are attached automatically from purchase history — nothing to type.
      </p>
    </div>
  )
}
