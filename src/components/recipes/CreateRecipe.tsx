'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createRecipe } from '@/server/recipes-actions'
import type { Section, Unit } from '@/lib/types'
import { parseMoney, parseQty } from '@/lib/money'
import { cardCls, fieldLabelCls, inputCls, numCls, selectCls } from '@/components/ui'

export default function CreateRecipe({
  kind,
  sections,
  units,
}: {
  kind: 'dish' | 'sub'
  sections: Section[]
  units: Unit[]
}) {
  const [name, setName] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [outputQty, setOutputQty] = useState(kind === 'dish' ? '1' : '')
  const [outputUnit, setOutputUnit] = useState(kind === 'dish' ? 'portion' : 'kg')
  const [sellingPrice, setSellingPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const qtyOk = parseQty(outputQty.trim()) !== null && Number(outputQty) > 0
  const priceOk = sellingPrice.trim() === '' || parseMoney(sellingPrice.trim()) !== null
  const canSave = !busy && name.trim() !== '' && qtyOk && priceOk && (kind === 'sub' || sectionId !== '')

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await createRecipe({
        kind,
        name: name.trim(),
        sectionId,
        outputQty: outputQty.trim(),
        outputUnit,
        sellingPrice: kind === 'dish' ? sellingPrice.trim() : '',
      })
      if (res.ok) {
        router.push(`/books/recipes/${res.id}`)
      } else {
        setError(res.error)
        setBusy(false)
      }
    } catch {
      setError('Could not reach the server — nothing was saved.')
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <section className={cardCls}>
        <div className="space-y-4">
          {kind === 'dish' && (
            <div>
              <span className={fieldLabelCls}>Section — it makes the code</span>
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
                    <span className={`ml-1 font-mono text-[11px] ${sectionId === s.id ? 'text-emerald-100' : 'text-stone-400'}`}>
                      {s.code}
                    </span>
                  </button>
                ))}
              </div>
              {sectionId !== '' && (
                <p className="mt-1.5 text-xs text-emerald-800/80">
                  Code assigns automatically on save:{' '}
                  <span className="font-mono font-medium">
                    {sections.find((s) => s.id === sectionId)?.code}-###
                  </span>{' '}
                  — the same code family as this section’s issues.
                </p>
              )}
            </div>
          )}

          <label className="block">
            <span className={fieldLabelCls}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'dish' ? 'e.g. Chilli Chicken' : 'e.g. Basic Gravy'}
              className={inputCls}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>{kind === 'sub' ? 'This batch makes' : 'Output'}</span>
              <div className="flex items-center gap-2">
                <input
                  inputMode="decimal"
                  value={outputQty}
                  onChange={(e) => setOutputQty(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="7"
                  className={`${numCls} w-24`}
                />
                <select value={outputUnit} onChange={(e) => setOutputUnit(e.target.value)} className={selectCls}>
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              {kind === 'sub' && (
                <span className="mt-1 block text-xs text-stone-500">
                  the batch yield — cooked-down weight, not the sum of ingredients
                </span>
              )}
            </label>
            {kind === 'dish' && (
              <label className="block">
                <span className={fieldLabelCls}>Selling price (optional)</span>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-stone-400">
                    ₹
                  </span>
                  <input
                    inputMode="decimal"
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value.replace(/[^\d.]/g, ''))}
                    placeholder="—"
                    className={`${inputCls} pl-7`}
                  />
                </div>
                <span className="mt-1 block text-xs text-stone-500">set it to see food-cost %</span>
              </label>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={!canSave}
        className="w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {busy ? 'Creating…' : kind === 'dish' ? 'Create dish → add ingredients' : 'Create sub-recipe → add ingredients'}
      </button>
      <Link
        href={`/books/recipes/new?kind=${kind === 'dish' ? 'sub' : 'dish'}`}
        className="block text-center text-sm font-medium text-stone-500 hover:text-emerald-700"
      >
        {kind === 'dish' ? 'Making a gravy or dough? Create a sub-recipe instead' : 'Making a menu item? Create a dish instead'}
      </Link>
    </div>
  )
}
