'use client'

// The count screen: every active item in stock order, a blank box against
// each. The counter types what the shelf actually holds — including 0, an
// empty shelf is information. Book quantity and cost are frozen server-side
// at save; the variance appears in the reveal, worst shortage first.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { CountableItem, SaveCountResult } from '@/lib/types'
import { saveCount } from '@/server/counts-actions'
import { decimalStringToPaise, formatMoneyString, parseQty } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls } from '@/components/ui'
import { useLang } from '@/components/useLang'

export function FirstCountWarning({ days }: { days: number }) {
  if (days >= 14) return null
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <span className="font-semibold">Book stock has only {days} {days === 1 ? 'day' : 'days'} of consumption behind
      it</span>{' '}
      — a variance now will mostly measure missing bills, not theft. Count anyway; just read it accordingly.
    </div>
  )
}

export default function CountEntry({ items, historyDays }: { items: CountableItem[]; historyDays: number }) {
  const { label } = useLang()
  const [countDate, setCountDate] = useState(todayLocal)
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState('')
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveCountResult, { ok: true }> | null>(null)

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (q === '') return items
    return items.filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
  }, [items, filter])

  const filled = Object.entries(qtys).filter(([, v]) => v.trim() !== '')
  const allValid = filled.every(([, v]) => parseQty(v.trim()) !== null)
  const canSave = !saving && filled.length > 0 && allValid

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveCount({
        countDate,
        note: note.trim(),
        lines: filled.map(([itemId, countedQty]) => ({ itemId, countedQty: countedQty.trim() })),
      })
      if (res.ok) setSaved(res)
      else setError(res.error)
    } catch {
      setError('Could not reach the server — the count was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  if (saved !== null) {
    const total = decimalStringToPaise(saved.count.total_variance_value)
    return (
      <div className="space-y-4">
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">
              Counted — {fmtDate(saved.count.count_date)}
            </h2>
            <span className="text-xs text-stone-400">frozen at save · count_variances</span>
          </div>
          <p className={`mt-2 text-3xl font-bold tabular-nums ${total < 0 ? 'text-red-700' : 'text-stone-900'}`}>
            {formatMoneyString(saved.count.total_variance_value)}
          </p>
          <p className="mt-0.5 text-sm text-stone-500">
            total variance across {saved.count.line_count} {saved.count.line_count === 1 ? 'item' : 'items'} — negative
            means the shelf holds less than the books say
          </p>
          <div className="mt-3">
            <FirstCountWarning days={saved.historyDays} />
          </div>
          <ul className="mt-2 divide-y divide-stone-100">
            {saved.variances.map((v) => {
              const neg = decimalStringToPaise(v.variance_value) < 0
              return (
                <li key={v.item_id} className={`py-2 ${neg ? 'rounded-lg bg-red-50 px-2' : ''}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-medium ${neg ? 'text-red-800' : 'text-stone-900'}`}>
                        {v.name}
                      </span>
                      <span className="block text-xs tabular-nums text-stone-500">
                        counted {v.counted_qty} · book {v.book_qty} {v.purchase_unit} · Δ {v.variance_qty}
                      </span>
                    </span>
                    <span className={`text-right text-sm font-semibold tabular-nums ${neg ? 'text-red-700' : 'text-stone-700'}`}>
                      {formatMoneyString(v.variance_value)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
        <Link
          href="/books/counts"
          className="block w-full rounded-xl bg-emerald-700 py-3 text-center text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          Back to counts
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <FirstCountWarning days={historyDays} />
      <section className={cardCls}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>{label('count_date')}</span>
            <input type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} className={`${numCls} w-full`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>{label('note')}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
          </label>
        </div>
        <label className="mt-3 block">
          <span className={fieldLabelCls}>{label('filter_items')}</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="type to narrow the list" className={inputCls} />
        </label>
        <p className="mt-3 text-xs text-stone-400">
          Stock order — richest shelf first. Leave blank what you did not count; type 0 for an empty shelf, it is
          information. Book quantities stay hidden until the save — the count is blind on purpose.
        </p>
        <ul className="mt-2 divide-y divide-stone-100">
          {visible.map((i) => {
            const v = qtys[i.id] ?? ''
            const bad = v.trim() !== '' && parseQty(v.trim()) === null
            return (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] text-stone-900">{i.name}</span>
                  <span className="block text-xs text-stone-500">
                    {i.code} · {i.category_name}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <input
                    inputMode="decimal"
                    placeholder="—"
                    value={v}
                    onChange={(e) => setQtys((q) => ({ ...q, [i.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                    className={`${numCls} w-24 text-right ${bad ? 'border-red-400' : ''}`}
                  />
                  <span className="w-10 text-xs text-stone-500">{i.purchase_unit}</span>
                </span>
              </li>
            )
          })}
          {visible.length === 0 && <li className="py-3 text-sm text-stone-400">No items match.</li>}
        </ul>
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
        {saving ? label('saving') : `${label('save_count')} (${filled.length})`}
      </button>
    </div>
  )
}
