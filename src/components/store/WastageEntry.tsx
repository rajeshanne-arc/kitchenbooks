'use client'

// Wastage is flat: one item, a quantity, a reason. The rupee value appears
// in the reveal, plainly — waste has a cost.

import { useState } from 'react'
import Link from 'next/link'
import type { IssuableItemHit, SaveWastageResult } from '@/lib/types'
import { saveWastage } from '@/server/store-actions'
import { parseQty, formatMoneyString } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls } from '@/components/ui'
import IssueItemPicker from './IssueItemPicker'
import { useLang } from '@/components/useLang'

const REASONS = ['Spoilage', 'Overproduction', 'Prep error', 'Expired', 'Other']

export default function WastageEntry() {
  const { label } = useLang()
  const [wasteDate, setWasteDate] = useState(todayLocal)
  const [item, setItem] = useState<IssuableItemHit | null>(null)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveWastageResult, { ok: true }> | null>(null)

  const qtyParsed = parseQty(qty.trim())
  const canSave = !saving && item !== null && qtyParsed !== null && qtyParsed > 0 && reason.trim() !== ''

  async function onSave() {
    if (!canSave || item === null) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveWastage({
        wasteDate,
        itemId: item.id,
        qty: qty.trim(),
        reason: reason.trim(),
        note: note.trim(),
      })
      if (res.ok) {
        setSaved(res)
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the wastage was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  function startAnother() {
    setSaved(null)
    setItem(null)
    setQty('')
    setReason('')
    setNote('')
    setError(null)
    setWasteDate(todayLocal())
  }

  if (saved !== null) {
    const { wastage, stock } = saved
    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-red-200 bg-red-50/60 p-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-red-700">Written off</h3>
          <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-red-700">
            {formatMoneyString(wastage.value)}
          </p>
          <p className="mt-1 text-[15px] text-stone-900">
            {wastage.qty} {wastage.purchase_unit} {wastage.item_name} · {wastage.reason}
          </p>
          <p className="mt-0.5 text-sm text-stone-500">
            {fmtDate(wastage.waste_date)}
            {wastage.note !== null && <> · {wastage.note}</>}
          </p>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-stone-500">Stock remaining</span>
            <span className="text-[15px] font-semibold tabular-nums text-stone-900">
              {stock.on_hand_qty} {stock.purchase_unit} of {stock.name}
            </span>
          </div>
          <p className="mt-1 text-xs text-stone-500">read live from stock_on_hand</p>
        </section>

        <button
          type="button"
          onClick={startAnother}
          className="w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          Record another
        </button>
        <Link
          href={`/books/wastage/${wastage.id}`}
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
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>{label('date')}</span>
              <input
                type="date"
                value={wasteDate}
                onChange={(e) => setWasteDate(e.target.value)}
                className={`${numCls} w-full`}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>{label('quantity')}</span>
              <div className="flex items-center gap-2">
                <input
                  inputMode="decimal"
                  placeholder="Qty"
                  value={qty}
                  onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))}
                  className={`${numCls} w-24`}
                />
                {item !== null && <span className="text-sm text-stone-500">{item.unit_name}</span>}
              </div>
            </label>
          </div>
          <div>
            <span className={fieldLabelCls}>{label('item')}</span>
            <IssueItemPicker value={item} onPick={setItem} onClear={() => setItem(null)} />
          </div>
          <label className="block">
            <span className={fieldLabelCls}>{label('reason')}</span>
            <input
              list="wastage-reasons"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Spoilage, Prep error… or type your own"
              className={inputCls}
              maxLength={60}
            />
            <datalist id="wastage-reasons">
              {REASONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>{label('note')}</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional"
              className={inputCls}
              maxLength={300}
            />
          </label>
        </div>
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
        {saving ? label('saving') : label('record_wastage')}
      </button>
      <p className="text-center text-xs text-stone-400">
        The cost is attached automatically from purchase history — the reveal will show what this waste is worth.
      </p>
    </div>
  )
}
