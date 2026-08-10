'use client'

// Standalone vendor birth (phase 14). Masters are still born on bills too
// — this is for setting one up ahead of its first purchase. Code and
// category lock forever at creation, same as the inline path.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Category } from '@/lib/types'
import { createVendor } from '@/server/books-actions'
import { cardCls, fieldLabelCls, inputCls, selectCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function VendorNew({ categories }: { categories: Category[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [gstin, setGstin] = useState('')
  const [phone, setPhone] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = !saving && name.trim() !== '' && category !== ''

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await createVendor({ name: name.trim(), category, gstin, phone, paymentTerms })
      if (res.ok) {
        toast(`${res.vendor.code} — ${res.vendor.name} created`)
        router.push(`/books/vendors/${res.vendor.id}`)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the vendor was not created. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={cardCls}>
      <div className="space-y-3">
        <label className="block">
          <span className={fieldLabelCls}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="the supplier’s name" className={inputCls} maxLength={120} />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Primary category — locks forever, it names the code series</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} (V-{c.code}-…)
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>GSTIN (optional)</span>
            <input value={gstin} onChange={(e) => setGstin(e.target.value)} className={inputCls} maxLength={20} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Phone (optional)</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} maxLength={20} />
          </label>
        </div>
        <label className="block">
          <span className={fieldLabelCls}>Payment terms (optional)</span>
          <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="weekly, 15 days…" className={inputCls} maxLength={120} />
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
        {saving ? 'Creating…' : 'Create vendor'}
      </button>
      <p className="mt-2 text-center text-xs text-stone-400">
        The code assigns itself in the same series bills use — V-CAT-NN, no forks.
      </p>
    </section>
  )
}
