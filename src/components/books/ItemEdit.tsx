'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateItem } from '@/server/books-actions'
import type { ItemDetail, Unit } from '@/lib/types'
import { cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'
import { LockedField } from './Locked'

const num = (s: string) => (s.trim() === '' ? null : Number(s))

export default function ItemEdit({ item, units }: { item: ItemDetail; units: Unit[] }) {
  const [name, setName] = useState(item.name)
  const [brand, setBrand] = useState(item.brand ?? '')
  const [gstRate, setGstRate] = useState(item.gst_rate ?? '')
  const [yieldPct, setYieldPct] = useState(item.yield_pct)
  const [parLevel, setParLevel] = useState(item.par_level ?? '')
  const [conversionFactor, setConversionFactor] = useState(item.conversion_factor)
  const [stockUnit, setStockUnit] = useState(item.stock_unit ?? '')
  const [openingRate, setOpeningRate] = useState(item.opening_rate ?? '')
  const [status, setStatus] = useState<'active' | 'inactive'>(item.status)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const yieldNum = num(yieldPct)
  const convNum = num(conversionFactor)
  const canSave =
    !busy &&
    name.trim() !== '' &&
    yieldNum !== null && yieldNum > 0 && yieldNum <= 100 &&
    convNum !== null && convNum > 0

  const touch = () => setSaved(false)

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await updateItem(item.id, {
        name: name.trim(),
        brand: brand.trim(),
        gstRate: gstRate.trim(),
        yieldPct: yieldPct.trim(),
        parLevel: parLevel.trim(),
        conversionFactor: conversionFactor.trim(),
        stockUnit,
        openingRate: openingRate.trim(),
        status,
      })
      if (res.ok) {
        setName(res.item.name)
        setBrand(res.item.brand ?? '')
        setGstRate(res.item.gst_rate ?? '')
        setYieldPct(res.item.yield_pct)
        setParLevel(res.item.par_level ?? '')
        setConversionFactor(res.item.conversion_factor)
        setStockUnit(res.item.stock_unit ?? '')
        setOpeningRate(res.item.opening_rate ?? '')
        setStatus(res.item.status)
        setSaved(true)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  const clean = (s: string) => s.replace(/[^\d.]/g, '')

  return (
    <section className={cardCls}>
      <div className="flex items-center justify-between">
        <h3 className={sectionHeadCls}>Details</h3>
        {saved && <span className="text-xs font-medium text-emerald-700">Saved ✓</span>}
      </div>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className={fieldLabelCls}>Name</span>
          <input value={name} onChange={(e) => { setName(e.target.value); touch() }} className={inputCls} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Brand</span>
            <input
              value={brand}
              onChange={(e) => { setBrand(e.target.value); touch() }}
              placeholder="optional"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>GST rate %</span>
            <input
              inputMode="decimal"
              value={gstRate}
              onChange={(e) => { setGstRate(clean(e.target.value)); touch() }}
              placeholder="—"
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-stone-500">reference only for now — per-line GST entry comes later</span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Yield %</span>
            <input
              inputMode="decimal"
              value={yieldPct}
              onChange={(e) => { setYieldPct(clean(e.target.value)); touch() }}
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-stone-500">
              100 means nothing is lost in prep — bone-in chicken used boneless is nearer 70.
            </span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Par level</span>
            <input
              inputMode="decimal"
              value={parLevel}
              onChange={(e) => { setParLevel(clean(e.target.value)); touch() }}
              placeholder="—"
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-stone-500">reorder when stock falls below this</span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Stock unit</span>
            <select
              value={stockUnit}
              onChange={(e) => { setStockUnit(e.target.value); touch() }}
              className={selectCls}
            >
              <option value="">same as purchase unit</option>
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-stone-500">how the kitchen counts it</span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Conversion factor</span>
            <input
              inputMode="decimal"
              value={conversionFactor}
              onChange={(e) => { setConversionFactor(clean(e.target.value)); touch() }}
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-stone-500">1 purchase unit = how many stock units</span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Opening rate</span>
            <input
              inputMode="decimal"
              value={openingRate}
              onChange={(e) => { setOpeningRate(clean(e.target.value)); touch() }}
              placeholder="—"
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-stone-500">seeds the rate prefill until the first bill sets it</span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Status</span>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value as 'active' | 'inactive'); touch() }}
              className={selectCls}
            >
              <option value="active">Active</option>
              <option value="inactive">Retired (inactive)</option>
            </select>
            <span className="mt-1 block text-xs text-stone-500">retire, never delete — history stays</span>
          </label>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={!canSave}
        className="mt-4 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {busy ? 'Saving…' : 'Save details'}
      </button>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <LockedField label="Code" value={item.code} reason="Permanent ID — all history hangs off it." />
        <LockedField
          label="Category"
          value={item.category_name}
          reason="The code series is built from this — it cannot change."
        />
        <LockedField
          label="Purchase unit"
          value={item.purchase_unit_name}
          reason="Every past line is priced in this unit — changing it would silently rescale history."
        />
      </div>
    </section>
  )
}
