'use client'

// Kitchen wastage: the section lost VALUE — a burnt gravy, a dropped tray.
// The rupee value is required and is what the chef states; item + qty are
// optional detail for when the loss is one ingredient.

import { useState } from 'react'
import type { IssuableItemHit, Section } from '@/lib/types'
import { saveKitchenWastage } from '@/server/kitchen-actions'
import { formatMoneyString, parseMoney, parseQty } from '@/lib/money'
import { todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, selectCls } from '@/components/ui'
import IssueItemPicker from '@/components/store/IssueItemPicker'
import { toast } from '@/components/Toasts'
import { useLang } from '@/components/useLang'

const REASONS = ['Burnt', 'Over-prepped', 'Dropped', 'Spoiled in kitchen', 'Trial dish', 'Other']

export default function KitchenWastageForm({ sections }: { sections: Section[] }) {
  const { label } = useLang()
  const [date, setDate] = useState(todayLocal)
  const [sectionId, setSectionId] = useState('')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [item, setItem] = useState<IssuableItemHit | null>(null)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valueParsed = parseMoney(value.trim())
  const pairOk = (item === null) === (qty.trim() === '')
  const qtyOk = qty.trim() === '' || (parseQty(qty.trim()) !== null && Number(qty.trim()) > 0)
  const canSave =
    !saving && sectionId !== '' && valueParsed !== null && valueParsed > 0 && reason.trim() !== '' && pairOk && qtyOk

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveKitchenWastage({
        date,
        sectionId,
        value: value.trim(),
        reason: reason.trim(),
        itemId: item?.id ?? '',
        qty: qty.trim(),
        note: note.trim(),
      })
      if (res.ok) {
        toast(`${res.wastage.section_code} wastage ${formatMoneyString(res.wastage.value)} recorded`)
        setValue('')
        setReason('')
        setItem(null)
        setQty('')
        setNote('')
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={cardCls}>
      <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">{label('kitchen_wastage_title')}</h2>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>{label('date')}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>{label('section')}</span>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={selectCls}>
              <option value="">—</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>{label('value_lost')}</span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${numCls} w-full text-right`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>{label('reason')}</span>
            <input
              list="kb-kitchen-reasons"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Burnt, dropped…"
              className={inputCls}
              maxLength={60}
            />
            <datalist id="kb-kitchen-reasons">
              {REASONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
        </div>
        <div>
          <span className={fieldLabelCls}>Item (optional detail — needs its quantity)</span>
          <IssueItemPicker value={item} onPick={setItem} onClear={() => setItem(null)} />
        </div>
        {item !== null && (
          <label className="block">
            <span className={fieldLabelCls}>Quantity ({item.unit_name})</span>
            <input
              inputMode="decimal"
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${numCls} w-28`}
            />
          </label>
        )}
        <label className="block">
          <span className={fieldLabelCls}>{label('note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
        </label>
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {saving ? label('saving') : label('record_kitchen_wastage')}
      </button>
    </section>
  )
}
