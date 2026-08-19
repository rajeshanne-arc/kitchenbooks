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
import { fmtDate } from '@/lib/format'
import {
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  tdCls,
  tdCodeCls,
  thCls,
  thNumCls,
} from '@/components/ui'
import { useLang } from '@/components/useLang'
import Honesty from '@/components/Honesty'
import { useBusinessToday } from '@/components/BusinessDay'

export function FirstCountWarning({ days }: { days: number }) {
  if (days >= 14) return null
  return (
    <Honesty verdict="thin history" meter={{ filled: days, total: 14, unit: 'days of consumption on the book' }}>
      Book stock has only {days} {days === 1 ? 'day' : 'days'} of consumption behind it. A variance today will
      mostly measure bills that were never entered, not theft. Count anyway — just read the result that way.
    </Honesty>
  )
}

export default function CountEntry({ items, historyDays }: { items: CountableItem[]; historyDays: number }) {
  const businessToday = useBusinessToday()
  const { label } = useLang()
  const [countDate, setCountDate] = useState(businessToday)
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
            <h2 className={sectionHeadCls}>
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
          <div className="mt-3 space-y-2">
            <FirstCountWarning days={saved.historyDays} />
            {/* AN ITEM NOT COUNTED IS NOT A ZERO — it is simply not in this
                count, so its book is untouched and its variance is unknown.
                Said here because the variance list looks complete: every row
                on it is an item somebody counted, and the ones that were
                skipped leave no row at all to notice. */}
            {items.length > saved.count.line_count && (
              <Honesty
                verdict="partly counted"
                meter={{ filled: saved.count.line_count, total: items.length, unit: 'items counted' }}
              >
                {items.length - saved.count.line_count} of {items.length} items were left blank. A blank is not a
                count of nothing — those items keep their book quantity and appear nowhere in the variance above, so
                accepting this count corrects only what was actually walked past.
              </Honesty>
            )}
          </div>
          <ul className="mt-2 divide-y divide-rule-soft">
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
        {/* The count has changed NOTHING yet, and this is the moment that
            fact is least obvious — the variance is on screen and it looks
            settled. Accepting is a separate judgement, so it is a separate
            press, and it is offered here while the shelves are still fresh
            in mind. */}
        <p className="text-sm text-stone-600">
          Nothing has moved in the book. A count records the difference; correcting the book is a decision somebody
          makes, on the count&rsquo;s own screen.
        </p>
        <Link
          href={`/store/stock/count/${saved.count.id}`}
          className="block w-full rounded-xl bg-emerald-700 py-3 text-center text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          Decide about this count →
        </Link>
        <Link
          href="/store/stock/count"
          className="block text-center text-sm font-medium text-stone-500 hover:text-stone-800"
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
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <p className="text-xs text-stone-500">
            Work down the sheet. Type 0 for an empty shelf — that is information, not a blank. Leave blank only
            what you did not reach.
          </p>
          <span className="shrink-0 font-mono text-xs tabular-nums text-stone-500">
            {filled.length} / {items.length}
          </span>
        </div>

        {/* A SHEET, not a search box. Rajesh's paper count lists every item
            with a box against it and you work down; a screen that makes you
            search for each one in turn is slower than the paper it replaces.
            The filter narrows a long sheet, it does not gate entry. */}
        <div className="mt-2 overflow-x-auto">
          <table className={dataTableCls}>
            <thead>
              <tr>
                <th className={thCls}>Item</th>
                <th className={thCls}>Code</th>
                <th className={thCls}>Category</th>
                <th className={`${thNumCls} w-28`}>Counted</th>
                <th className={thCls}>Unit</th>
              </tr>
            </thead>
            <tbody>
          {visible.map((i) => {
            const v = qtys[i.id] ?? ''
            const bad = v.trim() !== '' && parseQty(v.trim()) === null
            return (
              <tr key={i.id} className="h-11 hover:bg-stone-50">
                <td className={tdCls}>{i.name}</td>
                <td className={tdCodeCls}>{i.code}</td>
                <td className={`${tdCls} text-stone-500`}>{i.category_name}</td>
                <td className="border-b border-rule-soft px-1 py-1.5">
                  <input
                    inputMode="decimal"
                    placeholder="—"
                    aria-label={`Counted quantity of ${i.name}`}
                    value={v}
                    onChange={(e) => setQtys((q) => ({ ...q, [i.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                    className={`${numCls} w-full text-right font-mono tabular-nums ${bad ? 'border-red-400' : ''}`}
                  />
                </td>
                <td className={`${tdCls} text-stone-500`}>{i.purchase_unit}</td>
              </tr>
            )
          })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className={`${tdCls} text-stone-400`}>
                    No items match that filter — clear it to see the whole sheet again.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-stone-400">
          Book quantities stay hidden until the save — the count is blind on purpose. Seeing the book figure
          while counting turns a count into a confirmation of it.
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
        {saving ? label('saving') : `${label('save_count')} (${filled.length})`}
      </button>
    </div>
  )
}
