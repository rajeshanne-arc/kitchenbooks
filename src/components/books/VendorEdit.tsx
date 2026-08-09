'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateVendor } from '@/server/books-actions'
import type { VendorDetail } from '@/lib/types'
import { cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'
import { LockedField } from './Locked'

export default function VendorEdit({ vendor }: { vendor: VendorDetail }) {
  const [name, setName] = useState(vendor.name)
  const [phone, setPhone] = useState(vendor.phone ?? '')
  const [gstin, setGstin] = useState(vendor.gstin ?? '')
  const [paymentTerms, setPaymentTerms] = useState(vendor.payment_terms ?? '')
  const [supplies, setSupplies] = useState(vendor.supplies.join(', '))
  const [status, setStatus] = useState<'active' | 'inactive'>(vendor.status)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const canSave = !busy && name.trim() !== ''

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await updateVendor(vendor.id, {
        name: name.trim(),
        gstin: gstin.trim(),
        phone: phone.trim(),
        paymentTerms: paymentTerms.trim(),
        supplies: supplies.split(',').map((s) => s.trim()).filter(Boolean),
        status,
      })
      if (res.ok) {
        setName(res.vendor.name)
        setPhone(res.vendor.phone ?? '')
        setGstin(res.vendor.gstin ?? '')
        setPaymentTerms(res.vendor.payment_terms ?? '')
        setSupplies(res.vendor.supplies.join(', '))
        setStatus(res.vendor.status)
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
      <div className="flex items-center justify-between">
        <h3 className={sectionHeadCls}>Details</h3>
        {saved && <span className="text-xs font-medium text-emerald-700">Saved ✓</span>}
      </div>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className={fieldLabelCls}>Name</span>
          <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} className={inputCls} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Phone</span>
            <input value={phone} onChange={(e) => { setPhone(e.target.value); setSaved(false) }} className={inputCls} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>GSTIN</span>
            <input value={gstin} onChange={(e) => { setGstin(e.target.value); setSaved(false) }} className={inputCls} />
          </label>
        </div>
        <label className="block">
          <span className={fieldLabelCls}>Payment terms</span>
          <input
            value={paymentTerms}
            onChange={(e) => { setPaymentTerms(e.target.value); setSaved(false) }}
            placeholder="e.g. 15 days credit"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Supplies</span>
          <input
            value={supplies}
            onChange={(e) => { setSupplies(e.target.value); setSaved(false) }}
            placeholder="comma-separated — what they actually deliver"
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-stone-500">
            The category is locked to protect the code — this list is where reality lives.
          </span>
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Status</span>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as 'active' | 'inactive'); setSaved(false) }}
            className={selectCls}
          >
            <option value="active">Active</option>
            <option value="inactive">Retired (inactive)</option>
          </select>
          <span className="mt-1 block text-xs text-stone-500">
            Retiring hides the vendor from bill entry — history and dues stay. Nothing is ever deleted.
          </span>
        </label>
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

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <LockedField label="Code" value={vendor.code} reason="Permanent ID — every bill and due hangs off it." />
        <LockedField
          label="Category"
          value={vendor.category_name}
          reason="The code is built from this — it cannot change; use supplies for what they actually deliver."
        />
      </div>
    </section>
  )
}
