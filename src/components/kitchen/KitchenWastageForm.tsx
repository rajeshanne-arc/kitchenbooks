'use client'

// Kitchen wastage, phase-12 law: the loss is a COMPONENT (raw item, sub
// batch or plated dish — cost frozen server-side from the live books) or a
// plain rupee VALUE when nothing itemizable burned. Reason comes from the
// waste_reason list — free text survives only in the note.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { KitchenComponentHit, Section } from '@/lib/types'
import { saveKitchenWastage } from '@/server/kitchen-actions'
import { formatMoneyString, parseMoney, parseQty } from '@/lib/money'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls, selectCls } from '@/components/ui'
import KitchenComponentPicker from './KitchenComponentPicker'
import { toast } from '@/components/Toasts'
import { useLang } from '@/components/useLang'
import { useBusinessToday } from '@/components/BusinessDay'

export default function KitchenWastageForm({
  sections,
  wasteReasons,
}: {
  sections: Section[]
  wasteReasons: string[]
}) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const { label } = useLang()
  const [date, setDate] = useState(businessToday)
  const [sectionId, setSectionId] = useState('')
  const [mode, setMode] = useState<'component' | 'value'>('component')
  const [component, setComponent] = useState<KitchenComponentHit | null>(null)
  const [qty, setQty] = useState('')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const qtyOk = parseQty(qty.trim()) !== null && Number(qty.trim()) > 0
  const valueParsed = parseMoney(value.trim())
  const canSave =
    !saving &&
    sectionId !== '' &&
    reason !== '' &&
    (mode === 'component' ? component !== null && qtyOk : valueParsed !== null && valueParsed > 0)

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveKitchenWastage({
        date,
        sectionId,
        reason,
        note: note.trim(),
        component:
          mode === 'component' && component !== null
            ? component.kind === 'item'
              ? { kind: 'item', id: component.id, qty: qty.trim() }
              : { kind: 'recipe', id: component.id, qty: qty.trim() }
            : { kind: 'none', value: value.trim() },
      })
      if (res.ok) {
        toast(
          `${res.wastage.section_code} wastage ${formatMoneyString(res.wastage.value)} recorded${
            mode === 'component' ? ' — cost frozen from the books' : ''
          }`,
        )
        setComponent(null)
        setQty('')
        setValue('')
        setReason('')
        setNote('')
        router.refresh()
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
      <h2 className={sectionHeadCls}>{label('kitchen_wastage_title')}</h2>
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

        <div className="flex gap-2">
          {(
            [
              ['component', 'What was lost'],
              ['value', 'Value only'],
            ] as const
          ).map(([m, lbl]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                mode === m
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-stone-200 bg-white text-stone-600 hover:border-emerald-400'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {mode === 'component' ? (
          <>
            <KitchenComponentPicker
              value={component}
              onPick={setComponent}
              onClear={() => setComponent(null)}
              placeholder="What was lost — item, sub or dish"
            />
            {component !== null && (
              <label className="block">
                <span className={fieldLabelCls}>
                  {label('quantity')} ({component.unit_name})
                </span>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={qty}
                  onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))}
                  className={`${numCls} w-28`}
                />
              </label>
            )}
            <p className="text-xs text-stone-400">
              The rupee value is frozen from the live books at save — nothing to type.
            </p>
          </>
        ) : (
          <label className="block">
            <span className={fieldLabelCls}>{label('value_lost')}</span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${numCls} w-40 text-right`}
            />
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>{label('reason')}</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={selectCls}>
              <option value="">—</option>
              {wasteReasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>{label('note')}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
          </label>
        </div>
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
