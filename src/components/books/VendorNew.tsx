'use client'

// Standalone vendor birth (phase 14). Masters are still born on bills too
// — this is for setting one up ahead of its first purchase. Code and
// category lock forever at creation, same as the inline path.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Category, VendorDetail } from '@/lib/types'
import { createVendor } from '@/server/books-actions'
import { cardCls, fieldLabelCls, inputCls, numCls, selectCls } from '@/components/ui'
import { FormGroup, Wide } from '@/components/books/FormGroup'
import SaveAck from '@/components/SaveAck'

export default function VendorNew({ categories }: { categories: Category[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [gstin, setGstin] = useState('')
  const [phone, setPhone] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [more, setMore] = useState(false)
  const [x, setX] = useState({
    contactPerson: '',
    altPhone: '',
    email: '',
    address: '',
    bankName: '',
    accountNo: '',
    ifsc: '',
    upiId: '',
    natureOfSupply: '',
    openingBalance: '',
    supplies: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<VendorDetail | null>(null)

  const canSave = !saving && name.trim() !== '' && category !== ''

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await createVendor({ name: name.trim(), category, gstin, phone, paymentTerms, ...x })
      if (res.ok) {
        // Stay here. Setting up a new supply line usually means two or three
        // vendors in one sitting, and the vendor page is a place to read, not
        // the next thing to do.
        setSaved(res.vendor)
        setName('')
        setGstin('')
        setPhone('')
        setPaymentTerms('')
        setX({
          contactPerson: '',
          altPhone: '',
          email: '',
          address: '',
          bankName: '',
          accountNo: '',
          ifsc: '',
          upiId: '',
          natureOfSupply: '',
          openingBalance: '',
          supplies: '',
          notes: '',
        })
        setMore(false)
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
    <div className="space-y-4">
      {saved !== null && (
        <SaveAck
          onDismiss={() => setSaved(null)}
          headline={
            <>
              <span className="font-mono">{saved.code}</span> · {saved.name}
            </>
          }
          sub="the code and the category are locked from here on"
          missing={
            saved.account_no === null && saved.upi_id === null
              ? [
                  {
                    verdict: 'no way to pay them',
                    text: 'No account number and no UPI id, so when this vendor is owed money there is nothing to pay it into and somebody has to go and ask. The banking block on their page is copyable field by field, which is what it is for.',
                  },
                ]
              : undefined
          }
          actions={[{ href: `/store/masters/vendors/${saved.id}`, label: 'Open the vendor' }]}
        />
      )}
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

        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          className="w-full rounded-xl border border-dashed border-stone-300 py-2.5 text-sm font-medium text-stone-600 hover:border-emerald-400 hover:text-emerald-700"
        >
          {more ? '− Fewer details' : '＋ More details — contact, banking, opening balance'}
        </button>

        {more && (
          <div className="space-y-4 rounded-xl border border-rule bg-stone-50 p-3">
            <FormGroup title="Contact">
              <label className="block">
                <span className={fieldLabelCls}>Contact person</span>
                <input value={x.contactPerson} onChange={(e) => setX((v) => ({ ...v, contactPerson: e.target.value }))} className={inputCls} maxLength={120} />
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Alternate phone</span>
                <input value={x.altPhone} onChange={(e) => setX((v) => ({ ...v, altPhone: e.target.value }))} inputMode="tel" className={inputCls} maxLength={20} />
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Email</span>
                <input value={x.email} onChange={(e) => setX((v) => ({ ...v, email: e.target.value }))} inputMode="email" className={inputCls} maxLength={160} />
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Nature of supply</span>
                <input value={x.natureOfSupply} onChange={(e) => setX((v) => ({ ...v, natureOfSupply: e.target.value }))} placeholder="goods, service…" className={inputCls} maxLength={80} />
              </label>
              <Wide>
                <label className="block">
                  <span className={fieldLabelCls}>Address</span>
                  <textarea value={x.address} onChange={(e) => setX((v) => ({ ...v, address: e.target.value }))} rows={2} className={`${inputCls} resize-y`} maxLength={400} />
                </label>
              </Wide>
            </FormGroup>

            <FormGroup title="Banking" hint="What you copy into the bank app on payment day.">
              <label className="block">
                <span className={fieldLabelCls}>Bank name</span>
                <input value={x.bankName} onChange={(e) => setX((v) => ({ ...v, bankName: e.target.value }))} className={inputCls} maxLength={120} />
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Account number</span>
                <input value={x.accountNo} onChange={(e) => setX((v) => ({ ...v, accountNo: e.target.value }))} className={`${inputCls} font-mono`} maxLength={40} />
              </label>
              <label className="block">
                <span className={fieldLabelCls}>IFSC</span>
                <input value={x.ifsc} onChange={(e) => setX((v) => ({ ...v, ifsc: e.target.value.toUpperCase() }))} placeholder="HDFC0001234" className={`${inputCls} font-mono uppercase`} maxLength={20} />
              </label>
              <label className="block">
                <span className={fieldLabelCls}>UPI ID</span>
                <input value={x.upiId} onChange={(e) => setX((v) => ({ ...v, upiId: e.target.value }))} placeholder="name@bank" className={`${inputCls} font-mono`} maxLength={80} />
              </label>
            </FormGroup>

            <FormGroup title="Opening balance & supplies">
              <label className="block">
                <span className={fieldLabelCls}>Opening balance (₹)</span>
                <input
                  value={x.openingBalance}
                  onChange={(e) => setX((v) => ({ ...v, openingBalance: e.target.value.replace(/[^\d.-]/g, '') }))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className={`${numCls} w-full text-right font-mono tabular-nums`}
                />
                <span className="mt-1 block text-xs text-stone-500">What was already owed when the books started.</span>
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Supplies</span>
                <input value={x.supplies} onChange={(e) => setX((v) => ({ ...v, supplies: e.target.value }))} placeholder="chicken, eggs" className={inputCls} />
              </label>
              <Wide>
                <label className="block">
                  <span className={fieldLabelCls}>Notes</span>
                  <textarea value={x.notes} onChange={(e) => setX((v) => ({ ...v, notes: e.target.value }))} rows={2} className={`${inputCls} resize-y`} maxLength={2000} />
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
        {saving ? 'Creating…' : 'Create vendor'}
      </button>
      <p className="mt-2 text-center text-xs text-stone-400">
        The code assigns itself in the same series bills use — V-CAT-NN, no forks.
      </p>
    </section>
    </div>
  )
}
