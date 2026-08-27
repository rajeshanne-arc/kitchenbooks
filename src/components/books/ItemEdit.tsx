'use client'

// The whole item master, in five bands. Every column kb_app may UPDATE is
// here. yield_pct is NOT — the grant was revoked and yield now lives on the
// RECIPE LINE, editable there. See AGENTS.md: that rule has been reversed
// twice and the current ruling is per-line.
//
// code, category and purchase_unit have no UPDATE grant — shown LOCKED with
// the reason. Those three are the item's identity; changing them would
// rewrite history that bills already carry.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateItem } from '@/server/books-actions'
import type { ItemDetail, StorageLocation, Unit, VendorHit } from '@/lib/types'
import SaveAck from '@/components/SaveAck'
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

/**
 * A MERGED OR DISCARDED ROW IS A SIGNPOST, NOT A MASTER.
 *
 * The detail page does not mount the editor for one — but a hidden form is not
 * a check, and this is the second guarantee: the status select below offers
 * only Active and Retired, so a closed row would post 'merged' back and be
 * refused by the action with an enum message nobody could act on. Returning
 * null before any hook runs is the only way to say "this row is not editable"
 * without a coercion that would quietly relabel it as retired.
 */
export default function ItemEdit(props: {
  item: ItemDetail
  units: Unit[]
  /** active vendors, for the usual-supplier picker */
  vendors: VendorHit[]
  /** active storage locations, in walking order */
  locations: StorageLocation[]
}) {
  const status = props.item.status
  // Compared directly rather than through a boolean: TypeScript narrows a
  // property access on a comparison, not on an intermediate flag.
  if (status !== 'active' && status !== 'inactive') return null
  return <ItemEditForm {...props} status={status} />
}

function ItemEditForm({
  item,
  units,
  vendors,
  locations,
  status,
}: {
  item: ItemDetail
  units: Unit[]
  /** active vendors, for the usual-supplier picker */
  vendors: VendorHit[]
  /** active storage locations, in walking order */
  locations: StorageLocation[]
  /** narrowed by the wrapper above — a closed row never reaches here */
  status: 'active' | 'inactive'
}) {
  const [f, setF] = useState({
    name: item.name,
    brand: item.brand ?? '',
    gstRate: item.gst_rate ?? '',
    parLevel: item.par_level ?? '',
    tracksExpiry: item.tracks_expiry === true,
    conversionFactor: item.conversion_factor,
    stockUnit: item.stock_unit ?? '',
    openingRate: item.opening_rate ?? '',
    status,
    reorderLevel: item.reorder_level ?? '',
    storageLocationId: item.storage_location_id ?? '',
    defaultVendorId: item.default_vendor_id ?? '',
    itemType: item.item_type ?? '',
    notes: item.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [ack, setAck] = useState<ItemDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((s) => ({ ...s, [k]: v }))
    setAck(null)
  }

  const convNum = num(f.conversionFactor)
  const canSave = !busy && f.name.trim() !== '' && convNum !== null && convNum > 0

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    setAck(null)
    try {
      const res = await updateItem(item.id, {
        name: f.name.trim(),
        brand: f.brand.trim(),
        gstRate: f.gstRate.trim(),
        parLevel: f.parLevel.trim(),
        tracksExpiry: f.tracksExpiry,
        conversionFactor: f.conversionFactor.trim(),
        stockUnit: f.stockUnit.trim(),
        openingRate: f.openingRate.trim(),
        status: f.status,
        reorderLevel: f.reorderLevel.trim(),
        storageLocationId: f.storageLocationId,
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
          tracksExpiry: i.tracks_expiry === true,
          conversionFactor: i.conversion_factor,
          stockUnit: i.stock_unit ?? '',
          openingRate: i.opening_rate ?? '',
          // The form posts only 'active' or 'inactive', so that is all the
          // action can hand back. Narrowed rather than cast, so a widened
          // return type fails here instead of flowing into the select.
          status: i.status === 'active' ? 'active' : 'inactive',
          reorderLevel: i.reorder_level ?? '',
          storageLocationId: i.storage_location_id ?? '',
          defaultVendorId: i.default_vendor_id ?? '',
          itemType: i.item_type ?? '',
          notes: i.notes ?? '',
        })
        setAck(i)
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

  // WHAT LANDED, and what it unlocks. `saved ✓` sat at the TOP of this form
  // while the button is at the bottom — so on a phone nothing in view changed
  // at all. SaveAck scrolls itself into view, which is the whole point of it.
  const placed = locations.find((l) => l.id === ack?.storage_location_id)

  return (
    <section className={cardCls}>
      {ack !== null && (
        <div className="mb-3">
          <SaveAck
            headline={`${ack.name} saved`}
            sub={
              <>
                {placed === undefined ? 'not placed on any shelf' : `${placed.name} · in the count sheet's walk`}
                {ack.reorder_level === null
                  ? ' · no reorder level'
                  : ` · reorders at ${ack.reorder_level} ${ack.purchase_unit}`}
              </>
            }
            missing={[
              ...(placed === undefined
                ? [
                    {
                      verdict: 'not placed',
                      text: (
                        <>
                          This item has no storage location, so the count sheet cannot put it on anybody&apos;s
                          route — it sits at the bottom under “Not placed yet”, where it gets walked past.
                        </>
                      ),
                    },
                  ]
                : []),
              ...(ack.reorder_level === null
                ? [
                    {
                      verdict: 'no reorder level',
                      text: (
                        <>
                          Without one this item can never appear on Reorder, however low it runs. That list is
                          empty because the question has not been asked, not because the store is full.
                        </>
                      ),
                    },
                  ]
                : []),
            ]}
            onDismiss={() => setAck(null)}
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <h3 className={sectionHeadCls}>Item details</h3>
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
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={f.tracksExpiry}
                onChange={(e) => set('tracksExpiry', e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-rule text-emerald-700"
              />
              <span className="text-sm text-stone-700">
                This item carries a printed expiry date
                <span className="mt-0.5 block text-xs text-stone-500">
                  Asked for on every bill line for this item, and on no others. Onions carry no printed date,
                  and asking for one everywhere trains people to type anything.
                </span>
              </span>
            </label>
          </Wide>
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

        {/* NO FOLD ON THIS FORM — every group is visible, so these two are
            already where they will be answered. The copy matches the create
            form word for word: a field that blocks a feature says what it
            unlocks, in one line, wherever it appears. */}
        <FormGroup title="Ordering" hint="The two fields here each switch a whole tab on.">
          <Field label="Reorder level" hint="When stock falls to this, it appears on Reorder.">
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
            <Field
              label="Where it is kept"
              hint="Where it lives — sets the order you walk when counting. Left blank, it sits at the bottom of the sheet under “Not placed yet”, where it gets walked past."
            >
              <select
                value={f.storageLocationId}
                onChange={(e) => set('storageLocationId', e.target.value)}
                className={selectCls}
              >
                <option value="">— not placed yet —</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          </Wide>
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
