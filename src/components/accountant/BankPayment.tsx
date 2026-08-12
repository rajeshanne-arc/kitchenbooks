'use client'

// The accountant pays a vendor by transfer, from home.
//
// PRINCIPLE 1 OF THIS PHASE: whoever touches the money records it. The store
// manager handing cash to a vegetable vendor at the door records that
// payment — routing it through the accountant would only mean it went
// unrecorded. The accountant making a bank transfer at eleven at night
// records THAT one, here, for exactly the same reason.
//
// Same action as the store's own payment form: one recordPayment, one
// payments table, one PAY series. The two screens exist because two people
// are in two places, not because there are two kinds of payment.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MoneyAccount, PaymentResult, VendorDueRow } from '@/lib/types'
import { recordPayment } from '@/server/books-actions'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
import {
  btnCls,
  cardCls,
  docNoCls,
  fieldLabelCls,
  inputCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function BankPayment({
  vendors,
  accounts,
  modes,
}: {
  vendors: VendorDueRow[]
  accounts: MoneyAccount[]
  modes: string[]
}) {
  const router = useRouter()
  const [vendorId, setVendorId] = useState('')
  const [paidDate, setPaidDate] = useState(todayLocal())
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('')
  const [accountId, setAccountId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Extract<PaymentResult, { ok: true }> | null>(null)

  const chosen = vendors.find((v) => v.id === vendorId) ?? null
  const canSave =
    !busy &&
    vendorId !== '' &&
    accountId !== '' &&
    paidDate !== '' &&
    (parseMoney(amount.trim()) ?? 0) > 0

  async function save() {
    if (!canSave) return
    setBusy(true)
    try {
      const res = await recordPayment({
        vendorId,
        accountId,
        paidDate,
        amount: amount.trim(),
        mode,
        note: note.trim(),
      })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      setDone(res)
      setAmount('')
      setNote('')
      setAccountId('')
      router.refresh()
    } catch {
      toast('Could not reach the server — the payment was not recorded.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (vendors.length === 0) {
    return (
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Pay a vendor</h2>
        <p className="mt-1.5 text-sm text-stone-700">
          Nobody is owed anything. Vendors appear here once a bill has been entered against them.
        </p>
      </section>
    )
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Pay a vendor</h2>
      <p className="mt-1 text-xs text-stone-500">
        The transfer you make from home. The store records what it hands over at the door — one
        payments table either way.
      </p>

      {done !== null && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-stone-800">
          Recorded <span className="font-semibold tabular-nums">{formatMoneyString(done.payment.amount)}</span>{' '}
          on {fmtDate(done.payment.paid_date)} — dues{' '}
          <span className="tabular-nums">{formatMoneyString(done.duesBefore)}</span>
          {' → '}
          <span className="font-bold tabular-nums">{formatMoneyString(done.dues.balance)}</span>
          <span className="ml-1 text-xs text-stone-500">· read live from vendor_dues</span>
          {done.payment.doc_no !== null && (
            <span className={`mt-1 block ${docNoCls}`}>{done.payment.doc_no}</span>
          )}
        </div>
      )}

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className={fieldLabelCls}>Vendor</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={selectCls}>
            <option value="">—</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} — {formatMoneyString(v.balance)} owed
              </option>
            ))}
          </select>
          {chosen !== null && chosen.payment_terms !== null && (
            <span className="mt-1 block text-xs text-stone-500">terms: {chosen.payment_terms}</span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Date</span>
            <input
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Amount</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className={inputCls}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={selectCls}>
              <option value="">—</option>
              {modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <AccountPicker
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
            label="Paid from"
          />
        </div>

        <label className="block">
          <span className={fieldLabelCls}>Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="reference, invoice numbers settled"
            className={inputCls}
          />
        </label>

        <button type="button" disabled={!canSave} onClick={() => void save()} className={btnCls}>
          {busy ? 'Recording…' : 'Record payment'}
        </button>
      </div>
    </section>
  )
}
