'use client'

// The whole item master, in five bands. Every column kb_app may UPDATE is
// here except yield_pct, which is retired by rule: recipes state GROSS
// quantities, so trim yield lives in the recipe and an item-level yield
// field must not come back.
//
// code, category and purchase_unit have no UPDATE grant — shown LOCKED with
// the reason. Those three are the item's identity; changing them would
// rewrite history that bills already carry.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateItem } from '@/server/books-actions'
import type { ItemDetail, Unit, VendorHit } from '@/lib/types'
import { formatMoneyString } from '@/lib/money'
import { cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'
import { LockedField } from './Locked'
import { FormGroup, Wide } from './FormGroup'

const num = (s: string) => (s.trim() === '' ? null : Number(s))

const Field = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) => (
  <label className="block">
    <span className={fieldLabelCls}>{label}</span>
    {children}
    {hint !== undefined && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
  </label>
)

export default function ItemEdit({
  item,
  units,
  vendors,
}: {
  item: ItemDetail
  units: Unit[]
  /** active vendors, for the usual-supplier picker */
  vendors: VendorHit[]
}) {
  const [f, setF] = useState({
    name: item.name,
    brand: item.brand ?? '',
    gstRate: item.gst_rate ?? '',
    parLevel: item.par_level ?? '',
    conversionFactor: item.conversion_factor,
    stockUnit: item.stock_unit ?? '',
    openingRate: item.opening_rate ?? '',
    status: item.status,
    reorderLevel: item.reorder_level ?? '',
    defaultVendorId: item.default_vendor_id ?? '',
    itemType: item.item_type ?? '',
    notes: item.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((s) => ({ ...s, [k]: v }))
    setSaved(false)
  }

  const convNum = num(f.conversionFactor)
  const canSave = !busy && f.name.trim() !== '' && convNum !== null && convNum > 0

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await updateItem(item.id, {
        name: f.name.trim(),
        brand: f.brand.trim(),
        gstRate: f.gstRate.trim(),
        parLevel: f.parLevel.trim(),
        conversionFactor: f.conversionFactor.trim(),
        stockUnit: f.stockUnit.trim(),
        openingRate: f.openingRate.trim(),
        status: f.status,
        reorderLevel: f.reorderLevel.trim(),
        defaultVendorId: f.defaultVendorId,
        itemType: f.itemType.trim(),
        notes: f.notes.trim(),
      })
      if (res.ok) {
        const i = res.item
        setF({
          name: i.name,
          brand: i.brand ?? '',
          gstRate: i.gst_rate ?? '',
          parLevel: i.par_level ?? '',
          conversionFactor: i.conversion_factor,
          stockUnit: i.stock_unit ?? '',
          openingRate: i.opening_rate ?? '',
          status: i.status,
          reorderLevel: i.reorder_level ?? '',
          defaultVendorId: i.default_vendor_id ?? '',
          itemType: i.item_type ?? '',
          notes: i.notes ?? '',
        })
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

  return (
    <section className={cardCls}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={sectionHeadCls}>Item details</h3>
        {saved && <span className="text-xs font-medium text-emerald-700">saved ✓</span>}
      </div>

      <div className="mt-3 space-y-4">
        <FormGroup title="Identity">
          <Field label="Name">
            <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} maxLength={120} />
          </Field>
          <Field label="Brand">
            <input value={f.brand} onChange={(e) => set('brand', e.target.value)} className={inputCls} maxLength={80} />
          </Field>
          <Field label="Item type" hint="e.g. raw, packaged, consumable.">
            <input
              value={f.itemType}
              onChange={(e) => set('itemType', e.target.value)}
              className={inputCls}
              maxLength={40}
            />
          </Field>
          <Field label="Status">
            <select
              value={f.status}
              onChange={(e) => set('status', e.target.value as 'active' | 'inactive')}
              className={selectCls}
            >
              <option value="active">Active</option>
              <option value="inactive">Retired</option>
            </select>
          </Field>
          <LockedField
            label="Code"
            value={item.code}
            reason="Assigned once from the category, and already printed on bills."
          />
          <LockedField
            label="Category"
            value={item.category_name}
            reason="The category is baked into the code. A different category is a different item."
          />
        </FormGroup>

        <FormGroup
          title="Units & conversion"
          hint="You buy in one unit and issue in another; the factor is how many stock units come in one purchase unit."
        >
          <LockedField
            label="Purchase unit"
            value={item.purchase_unit_name ?? item.purchase_unit}
            reason="Every bill line already uses this unit — changing it would rewrite past quantities."
          />
          <Field label="Stock unit">
            <select value={f.stockUnit} onChange={(e) => set('stockUnit', e.target.value)} className={selectCls}>
              <option value="">— same as purchase unit —</option>
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Wide>
            <Field
              label="Conversion factor"
              hint={`1 ${item.purchase_unit} = this many ${f.stockUnit === '' ? item.purchase_unit : f.stockUnit}.`}
            >
              <input
                value={f.conversionFactor}
                onChange={(e) => set('conversionFactor', e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                className={`${inputCls} text-right font-mono tabular-nums`}
              />
            </Field>
          </Wide>
        </FormGroup>

        <FormGroup title="Costing">
          <Field
            label="Opening rate (₹)"
            hint="The rate before any bill existed — used until the first purchase gives a real one."
          >
            <input
              value={f.openingRate}
              onChange={(e) => set('openingRate', e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className={`${inputCls} text-right font-mono tabular-nums`}
            />
          </Field>
          <Field label="GST rate (%)" hint="Reference only — per-line GST arrives in a later phase.">
            <input
              value={f.gstRate}
              onChange={(e) => set('gstRate', e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className={`${inputCls} text-right font-mono tabular-nums`}
            />
          </Field>
          <Wide>
            <p className="rounded-lg border border-rule bg-stone-50 px-3 py-2 text-xs text-stone-600">
              {item.last_rate === null ? (
                <>No purchase yet — issues would cost at the opening rate.</>
              ) : (
                <>
                  Last paid{' '}
                  <span className="font-mono font-semibold tabular-nums text-stone-900">
                    {formatMoneyString(item.last_rate)}
                  </span>
                  {item.last_rate_date !== null && <> on {item.last_rate_date}</>}{' '}
                  <span className="text-stone-400">· item_rates</span>
                </>
              )}
            </p>
          </Wide>
        </FormGroup>

        <FormGroup
          title="Ordering"
          hint="Set a reorder level and this item starts appearing on the Reorder tab when stock falls to it."
        >
          <Field label="Reorder level" hint="Stock at or below this asks to be bought.">
            <input
              value={f.reorderLevel}
              onChange={(e) => set('reorderLevel', e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className={`${inputCls} text-right font-mono tabular-nums`}
            />
          </Field>
          <Field label="Par level" hint="What a full shelf looks like — the reorder suggestion aims here.">
            <input
              value={f.parLevel}
              onChange={(e) => set('parLevel', e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className={`${inputCls} text-right font-mono tabular-nums`}
            />
          </Field>
          <Wide>
            <Field label="Usual vendor" hint="Groups this item onto one supplier's reorder list.">
              <select
                value={f.defaultVendorId}
                onChange={(e) => set('defaultVendorId', e.target.value)}
                className={selectCls}
              >
                <option value="">— none —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.code})
                  </option>
                ))}
              </select>
            </Field>
          </Wide>
        </FormGroup>

        <FormGroup title="Notes">
          <Wide>
            <Field label="Notes" hint="Grade, packing, the shop it comes from — anything worth remembering.">
              <textarea
                value={f.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={3}
                className={`${inputCls} resize-y`}
                maxLength={2000}
              />
            </Field>
          </Wide>
        </FormGroup>
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
        {busy ? 'Saving…' : 'Save item'}
      </button>
    </section>
  )
}
