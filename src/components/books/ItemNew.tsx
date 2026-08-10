'use client'

// Standalone item birth (phase 14). Until its first bill lands, the item
// costs at opening_rate (if given) and is otherwise un-issuable — the
// stock spine stays honest.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Category, Unit } from '@/lib/types'
import { createItem } from '@/server/books-actions'
import { cardCls, fieldLabelCls, inputCls, selectCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function ItemNew({ categories, units }: { categories: Category[]; units: Unit[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [purchaseUnit, setPurchaseUnit] = useState('')
  const [openingRate, setOpeningRate] = useState('')
  const [brand, setBrand] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = !saving && name.trim() !== '' && category !== '' && purchaseUnit !== ''

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await createItem({ name: name.trim(), category, purchaseUnit, openingRate: openingRate.trim(), brand })
      if (res.ok) {
        toast(`${res.item.code} — ${res.item.name} created`)
        router.push(`/books/items/${res.item.id}`)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the item was not created. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={cardCls}>
      <div className="space-y-3">
        <label className="block">
          <span className={fieldLabelCls}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="what the store calls it" className={inputCls} maxLength={120} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Category — locks forever</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code}-…)
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Purchase unit — locks forever</span>
            <select value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} className={selectCls}>
              <option value="">—</option>
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Opening rate (₹, optional)</span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={openingRate}
              onChange={(e) => setOpeningRate(e.target.value.replace(/[^\d.]/g, ''))}
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-stone-400">issues can cost against it until the first bill</span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Brand (optional)</span>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} maxLength={80} />
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
        {saving ? 'Creating…' : 'Create item'}
      </button>
      <p className="mt-2 text-center text-xs text-stone-400">
        The code assigns itself in the same series bills use — CAT-NNN, no forks.
      </p>
    </section>
  )
}
