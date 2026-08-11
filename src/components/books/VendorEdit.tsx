'use client'

// The whole vendor master, in five bands. Every column kb_app may UPDATE is
// here; the two it may not — code and primary_category — are shown LOCKED
// with the reason, never hidden, because a field you cannot find is worse
// than a field you cannot change.
//
// opening_balance is the load-bearing one. vendor_dues computes
// opening_balance + purchased − paid, so a vendor carried over from the
// sheets with money already owed reads as ₹0 until this is filled in. It has
// never been fillable until now.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateVendor } from '@/server/books-actions'
import type { VendorDetail } from '@/lib/types'
import { formatMoneyString } from '@/lib/money'
import { cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'
import { LockedField } from './Locked'
import { FormGroup, Wide } from './FormGroup'

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

export default function VendorEdit({ vendor }: { vendor: VendorDetail }) {
  const [f, setF] = useState({
    name: vendor.name,
    phone: vendor.phone ?? '',
    gstin: vendor.gstin ?? '',
    paymentTerms: vendor.payment_terms ?? '',
    supplies: vendor.supplies.join(', '),
    status: vendor.status,
    contactPerson: vendor.contact_person ?? '',
    altPhone: vendor.alt_phone ?? '',
    email: vendor.email ?? '',
    address: vendor.address ?? '',
    bankName: vendor.bank_name ?? '',
    accountNo: vendor.account_no ?? '',
    ifsc: vendor.ifsc ?? '',
    upiId: vendor.upi_id ?? '',
    natureOfSupply: vendor.nature_of_supply ?? '',
    openingBalance: vendor.opening_balance === '0' ? '' : vendor.opening_balance,
    notes: vendor.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((s) => ({ ...s, [k]: v }))
    setSaved(false)
  }

  const canSave = !busy && f.name.trim() !== ''

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await updateVendor(vendor.id, {
        name: f.name.trim(),
        gstin: f.gstin.trim(),
        phone: f.phone.trim(),
        paymentTerms: f.paymentTerms.trim(),
        supplies: f.supplies.split(',').map((s) => s.trim()).filter(Boolean),
        status: f.status,
        contactPerson: f.contactPerson.trim(),
        altPhone: f.altPhone.trim(),
        email: f.email.trim(),
        address: f.address.trim(),
        bankName: f.bankName.trim(),
        accountNo: f.accountNo.trim(),
        ifsc: f.ifsc.trim(),
        upiId: f.upiId.trim(),
        natureOfSupply: f.natureOfSupply.trim(),
        openingBalance: f.openingBalance.trim(),
        notes: f.notes.trim(),
      })
      if (res.ok) {
        const v = res.vendor
        setF({
          name: v.name,
          phone: v.phone ?? '',
          gstin: v.gstin ?? '',
          paymentTerms: v.payment_terms ?? '',
          supplies: v.supplies.join(', '),
          status: v.status,
          contactPerson: v.contact_person ?? '',
          altPhone: v.alt_phone ?? '',
          email: v.email ?? '',
          address: v.address ?? '',
          bankName: v.bank_name ?? '',
          accountNo: v.account_no ?? '',
          ifsc: v.ifsc ?? '',
          upiId: v.upi_id ?? '',
          natureOfSupply: v.nature_of_supply ?? '',
          openingBalance: v.opening_balance === '0' ? '' : v.opening_balance,
          notes: v.notes ?? '',
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
        <h3 className={sectionHeadCls}>Vendor details</h3>
        {saved && <span className="text-xs font-medium text-emerald-700">saved ✓</span>}
      </div>

      <div className="mt-3 space-y-4">
        <FormGroup title="Identity">
          <Field label="Name">
            <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} maxLength={120} />
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
            value={vendor.code}
            reason="Codes are assigned once and never reused — bills already carry this one."
          />
          <LockedField
            label="Primary category"
            value={vendor.category_name}
            reason="The category is baked into the code. A vendor who changes trade is a new vendor."
          />
          <Wide>
            <Field
              label="Supplies"
              hint="Comma separated — what they actually deliver, in your own words."
            >
              <input
                value={f.supplies}
                onChange={(e) => set('supplies', e.target.value)}
                placeholder="chicken, eggs"
                className={inputCls}
              />
            </Field>
          </Wide>
        </FormGroup>

        <FormGroup title="Contact" hint="Who you call when the delivery is late.">
          <Field label="Contact person">
            <input
              value={f.contactPerson}
              onChange={(e) => set('contactPerson', e.target.value)}
              className={inputCls}
              maxLength={120}
            />
          </Field>
          <Field label="Phone">
            <input
              value={f.phone}
              onChange={(e) => set('phone', e.target.value)}
              inputMode="tel"
              className={inputCls}
              maxLength={20}
            />
          </Field>
          <Field label="Alternate phone">
            <input
              value={f.altPhone}
              onChange={(e) => set('altPhone', e.target.value)}
              inputMode="tel"
              className={inputCls}
              maxLength={20}
            />
          </Field>
          <Field label="Email">
            <input
              value={f.email}
              onChange={(e) => set('email', e.target.value)}
              inputMode="email"
              className={inputCls}
              maxLength={160}
            />
          </Field>
          <Wide>
            <Field label="Address">
              <textarea
                value={f.address}
                onChange={(e) => set('address', e.target.value)}
                rows={2}
                className={`${inputCls} resize-y`}
                maxLength={400}
              />
            </Field>
          </Wide>
        </FormGroup>

        <FormGroup
          title="Banking"
          hint="What you copy into the bank app on payment day — get it exactly right once."
        >
          <Field label="Bank name">
            <input
              value={f.bankName}
              onChange={(e) => set('bankName', e.target.value)}
              className={inputCls}
              maxLength={120}
            />
          </Field>
          <Field label="Account number">
            <input
              value={f.accountNo}
              onChange={(e) => set('accountNo', e.target.value)}
              className={`${inputCls} font-mono`}
              maxLength={40}
            />
          </Field>
          <Field label="IFSC" hint="4 letters, a zero, then 6 characters.">
            <input
              value={f.ifsc}
              onChange={(e) => set('ifsc', e.target.value.toUpperCase())}
              placeholder="HDFC0001234"
              className={`${inputCls} font-mono uppercase`}
              maxLength={20}
            />
          </Field>
          <Field label="UPI ID">
            <input
              value={f.upiId}
              onChange={(e) => set('upiId', e.target.value)}
              placeholder="name@bank"
              className={`${inputCls} font-mono`}
              maxLength={80}
            />
          </Field>
        </FormGroup>

        <FormGroup title="Terms & opening balance">
          <Field label="Payment terms" hint="e.g. 15 days, on delivery, weekly.">
            <input
              value={f.paymentTerms}
              onChange={(e) => set('paymentTerms', e.target.value)}
              className={inputCls}
              maxLength={120}
            />
          </Field>
          <Field label="Nature of supply" hint="e.g. goods, service, both.">
            <input
              value={f.natureOfSupply}
              onChange={(e) => set('natureOfSupply', e.target.value)}
              className={inputCls}
              maxLength={80}
            />
          </Field>
          <Field label="GSTIN">
            <input
              value={f.gstin}
              onChange={(e) => set('gstin', e.target.value.toUpperCase())}
              className={`${inputCls} font-mono uppercase`}
              maxLength={20}
            />
          </Field>
          <Field
            label="Opening balance (₹)"
            hint="What was already owed on the day the books started. Dues read opening + purchased − paid, so this is the only way carried-over debt becomes true."
          >
            <input
              value={f.openingBalance}
              onChange={(e) => set('openingBalance', e.target.value.replace(/[^\d.-]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className={`${inputCls} text-right font-mono tabular-nums`}
            />
          </Field>
          <Wide>
            <p className="rounded-lg border border-rule bg-stone-50 px-3 py-2 text-xs text-stone-600">
              Balance now:{' '}
              <span className="font-mono font-semibold tabular-nums text-stone-900">
                {formatMoneyString(vendor.balance)}
              </span>{' '}
              = opening {formatMoneyString(vendor.opening_balance)} + purchased{' '}
              {formatMoneyString(vendor.purchased)} − paid {formatMoneyString(vendor.paid)}{' '}
              <span className="text-stone-400">· vendor_dues</span>
            </p>
          </Wide>
        </FormGroup>

        <FormGroup title="Notes">
          <Wide>
            <Field label="Notes" hint="Anything the next person needs to know. Free text — this one is not a list.">
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
        {busy ? 'Saving…' : 'Save vendor'}
      </button>
    </section>
  )
}
