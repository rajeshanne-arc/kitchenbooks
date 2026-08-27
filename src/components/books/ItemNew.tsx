'use client'

// Standalone item birth (phase 14). Until its first bill lands, the item
// costs at opening_rate (if given) and is otherwise un-issuable — the
// stock spine stays honest.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Category, ItemDetail, StorageLocation, Unit, VendorHit } from '@/lib/types'
import { createItem } from '@/server/books-actions'
import { cardCls, fieldLabelCls, inputCls, numCls, selectCls } from '@/components/ui'
import { FormGroup, Wide } from '@/components/books/FormGroup'
import SaveAck from '@/components/SaveAck'

// The five fields that cannot wait are asked first; every other column the
// database will accept sits behind a fold. It is one form, not two trips —
// a reorder level nobody set on the way past is a reorder level nobody ever
// sets, and the Reorder tab stays empty forever.

export default function ItemNew({
  categories,
  units,
  vendors,
  locations,
}: {
  categories: Category[]
  units: Unit[]
  vendors: VendorHit[]
  /** active storage locations, in walking order */
  locations: StorageLocation[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [purchaseUnit, setPurchaseUnit] = useState('')
  const [openingRate, setOpeningRate] = useState('')
  const [brand, setBrand] = useState('')
  const [more, setMore] = useState(false)
  const [x, setX] = useState({
    stockUnit: '',
    conversionFactor: '',
    gstRate: '',
    parLevel: '',
    tracksExpiry: false,
    reorderLevel: '',
    storageLocationId: '',
    defaultVendorId: '',
    itemType: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<ItemDetail | null>(null)

  const canSave = !saving && name.trim() !== '' && category !== '' && purchaseUnit !== ''

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await createItem({
        name: name.trim(),
        category,
        purchaseUnit,
        openingRate: openingRate.trim(),
        brand,
        ...x,
      })
      if (res.ok) {
        // STAY HERE. Items are created in runs — a delivery brings four new
        // things at once — and being thrown onto the item page after each one
        // made the second a trip back. The code is the reason to acknowledge
        // at all: it is assigned in the save transaction and is what the
        // store writes on the shelf.
        setSaved(res.item)
        setName('')
        setBrand('')
        setOpeningRate('')
        setX({
          stockUnit: '',
          conversionFactor: '',
          gstRate: '',
          parLevel: '',
          tracksExpiry: false,
          reorderLevel: '',
          storageLocationId: '',
          defaultVendorId: '',
          itemType: '',
          notes: '',
        })
        setMore(false)
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
    <div className="space-y-4">
      {saved !== null && (
        <SaveAck
          onDismiss={() => setSaved(null)}
          headline={
            <>
              <span className="font-mono">{saved.code}</span> · {saved.name}
            </>
          }
          sub={`${saved.category} · bought in ${saved.purchase_unit} — the code and the unit are locked from here on`}
          missing={
            saved.reorder_level === null
              ? [
                  {
                    verdict: 'no reorder level',
                    text: 'Nothing will ever prompt anyone to buy this — the Reorder tab only lists items that carry a level. Set one on the item page, or the next time you run out you find out from the kitchen.',
                  },
                ]
              : undefined
          }
          actions={[{ href: `/store/masters/items/${saved.id}`, label: 'Open the item' }]}
        />
      )}
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

        {/* A FIELD THAT BLOCKS A FEATURE DOES NOT GO BEHIND A FOLD.
            Both of these were inside "＋ More details", and the data said what
            that costs: every item had neither. No reorder level means the
            Reorder tab can never show anything; no location means the count
            sheet is one "Not placed yet" band. Conversion, GST, item type and
            notes stay folded — they block nothing.

            Same principle as the readiness card: ask for what the app cannot
            work without WHERE IT WILL BE ANSWERED, not where it is tidy. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabelCls}>Where it is kept</span>
            <select
              value={x.storageLocationId}
              onChange={(e) => setX((v) => ({ ...v, storageLocationId: e.target.value }))}
              className={selectCls}
            >
              <option value="">— not placed yet —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-stone-500">
              {locations.length === 0
                ? 'No location exists yet — a manager or owner adds them under Locations.'
                : 'Where it lives — sets the order you walk when counting.'}
            </span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Reorder level (optional)</span>
            <input
              value={x.reorderLevel}
              onChange={(e) => setX((v) => ({ ...v, reorderLevel: e.target.value.replace(/[^\d.]/g, '') }))}
              inputMode="decimal"
              placeholder="0"
              className={`${numCls} w-full text-right font-mono tabular-nums`}
            />
            <span className="mt-1 block text-xs text-stone-500">
              When stock falls to this, it appears on Reorder.
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          className="w-full rounded-xl border border-dashed border-stone-300 py-2.5 text-sm font-medium text-stone-600 hover:border-emerald-400 hover:text-emerald-700"
        >
          {more ? '− Fewer details' : '＋ More details — units, costing, supplier, notes'}
        </button>

        {more && (
          <div className="space-y-4 rounded-xl border border-rule bg-stone-50 p-3">
            <FormGroup title="Units & conversion" hint="Leave blank if you buy and issue in the same unit.">
              <label className="block">
                <span className={fieldLabelCls}>Stock unit</span>
                <select
                  value={x.stockUnit}
                  onChange={(e) => setX((v) => ({ ...v, stockUnit: e.target.value }))}
                  className={selectCls}
                >
                  <option value="">— same as purchase unit —</option>
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Conversion factor</span>
                <input
                  value={x.conversionFactor}
                  onChange={(e) => setX((v) => ({ ...v, conversionFactor: e.target.value.replace(/[^\d.]/g, '') }))}
                  inputMode="decimal"
                  placeholder="1"
                  className={`${numCls} w-full text-right font-mono tabular-nums`}
                />
              </label>
            </FormGroup>

            <FormGroup title="Costing">
              <label className="block">
                <span className={fieldLabelCls}>GST rate (%)</span>
                <input
                  value={x.gstRate}
                  onChange={(e) => setX((v) => ({ ...v, gstRate: e.target.value.replace(/[^\d.]/g, '') }))}
                  inputMode="decimal"
                  className={`${numCls} w-full text-right font-mono tabular-nums`}
                />
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Item type</span>
                <input
                  value={x.itemType}
                  onChange={(e) => setX((v) => ({ ...v, itemType: e.target.value }))}
                  placeholder="raw, packaged…"
                  className={inputCls}
                  maxLength={40}
                />
              </label>
            </FormGroup>

            <FormGroup title="Ordering" hint="Par level and the usual supplier — neither blocks anything.">
              <label className="block">
                <span className={fieldLabelCls}>Par level</span>
                <input
                  value={x.parLevel}
                  onChange={(e) => setX((v) => ({ ...v, parLevel: e.target.value.replace(/[^\d.]/g, '') }))}
                  inputMode="decimal"
                  className={`${numCls} w-full text-right font-mono tabular-nums`}
                />
              </label>
              <label className="mt-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={x.tracksExpiry}
                  onChange={(e) => setX((v) => ({ ...v, tracksExpiry: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-rule text-emerald-700"
                />
                <span className="text-sm text-stone-700">
                  This item carries a printed expiry date
                  <span className="mt-0.5 block text-xs text-stone-500">
                    Asked for on every bill line for this item, and on no others. Onions carry no printed
                    date, and asking for one everywhere trains people to type anything.
                  </span>
                </span>
              </label>
              <Wide>
                <label className="block">
                  <span className={fieldLabelCls}>Usual vendor</span>
                  <select
                    value={x.defaultVendorId}
                    onChange={(e) => setX((v) => ({ ...v, defaultVendorId: e.target.value }))}
                    className={selectCls}
                  >
                    <option value="">— none —</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.code})
                      </option>
                    ))}
                  </select>
                </label>
              </Wide>
            </FormGroup>

            <FormGroup title="Notes">
              <Wide>
                <label className="block">
                  <span className={fieldLabelCls}>Notes</span>
                  <textarea
                    value={x.notes}
                    onChange={(e) => setX((v) => ({ ...v, notes: e.target.value }))}
                    rows={2}
                    className={`${inputCls} resize-y`}
                    maxLength={2000}
                  />
                </label>
              </Wide>
            </FormGroup>
          </div>
        )}
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
    </div>
  )
}
