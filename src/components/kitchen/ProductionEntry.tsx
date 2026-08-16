'use client'

// Production RECORDS a batch — it never moves inventory. Only sub-recipes
// are producible (the server refuses dishes); unit cost is frozen from
// recipe_costs.cost_per_output_unit at save and appears only in the
// after-save reveal, never as an input.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SaveProductionResult, Section, SubCostRow } from '@/lib/types'
import { saveProduction } from '@/server/kitchen-actions'
import { formatMoneyString, parseQty } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls, selectCls } from '@/components/ui'
import { useLang } from '@/components/useLang'
import { useBusinessToday } from '@/components/BusinessDay'

export default function ProductionEntry({ sections, subs }: { sections: Section[]; subs: SubCostRow[] }) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const { label } = useLang()
  const [date, setDate] = useState(businessToday)
  const [sectionId, setSectionId] = useState('')
  const [recipeId, setRecipeId] = useState('')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveProductionResult, { ok: true }> | null>(null)

  const sub = subs.find((s) => s.recipe_id === recipeId) ?? null
  const canSave =
    !saving && sectionId !== '' && recipeId !== '' && parseQty(qty.trim()) !== null && Number(qty.trim()) > 0

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveProduction({ date, sectionId, recipeId, outputQty: qty.trim(), note: note.trim() })
      if (res.ok) {
        setSaved(res)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the production was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  function startAnother() {
    setSaved(null)
    setRecipeId('')
    setQty('')
    setNote('')
    setError(null)
  }

  if (saved !== null) {
    const p = saved.production
    return (
      <section className={cardCls}>
        <h2 className="text-lg font-bold text-stone-900">
          {p.recipe_name} — {p.output_qty} {p.output_unit}
        </h2>
        <p className="text-sm text-stone-500">
          {p.section_name} · {fmtDate(p.prod_date)}
        </p>
        <div className="mt-3 divide-y divide-rule-soft border-t border-stone-100">
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-stone-600">Unit cost (frozen at save)</span>
            <span className="tabular-nums text-sm text-stone-700">{formatMoneyString(p.unit_cost)}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-semibold text-stone-900">Batch value</span>
            <span className="text-xl font-bold tabular-nums text-stone-900">{formatMoneyString(p.value)}</span>
          </div>
        </div>
        <p className="mt-1 text-xs text-stone-400">
          recorded, not moved — issues already carried the ingredients out of the store
        </p>
        <button
          type="button"
          onClick={startAnother}
          className="mt-3 w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          Record another batch
        </button>
      </section>
    )
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Record production</h2>
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
        <label className="block">
          <span className={fieldLabelCls}>Sub-recipe (batches only — dishes are sold, not produced)</span>
          <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} className={selectCls}>
            <option value="">—</option>
            {subs.map((s) => (
              <option key={s.recipe_id} value={s.recipe_id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
          {subs.length === 0 && (
            <p className="mt-1 text-xs text-amber-700">
              No sub-recipes yet — create one on the Recipes tab first (a sub&apos;s output IS its batch yield).
            </p>
          )}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Output {sub !== null ? `(${sub.output_unit})` : 'quantity'}</span>
            <input
              inputMode="decimal"
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${numCls} w-full`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>{label('note')}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
          </label>
        </div>
      </div>
      {sub !== null && Number(sub.uncosted_lines) > 0 && (
        <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          {sub.uncosted_lines} of this sub&apos;s ingredients have no cost yet — its batch cost is understated until
          their bills arrive.
        </p>
      )}
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
        {saving ? label('saving') : 'Record production'}
      </button>
      <p className="mt-2 text-center text-xs text-stone-400">
        Cost per unit is frozen from the live recipe card at save — nothing to type.
      </p>
    </section>
  )
}
