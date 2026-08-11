'use client'

// Cash voucher: who was paid, how much, and — load-bearing — WHO PAID.
// Cashier-paid leaves the drawer and lands on the day's ladder; owner-paid
// NEVER touches the drawer math and instead opens a debt in owners_owed.
// Names come from pickers, because “Asheel” and “Asheel Sir” would never
// net against each other.

import { useState } from 'react'
import type { PaidBy, SaveVoucherResult } from '@/lib/types'
import { saveVoucher } from '@/server/cash-actions'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls, selectCls } from '@/components/ui'

export default function VoucherForm({
  ownerNames,
  categories,
  paidToNames = [],
}: {
  ownerNames: string[]
  /** ACTIVE voucher_category list values (LAW 2) — display form; the save normalizes */
  categories: string[]
  paidToNames?: string[]
}) {
  const [date, setDate] = useState(todayLocal)
  const [amount, setAmount] = useState('')
  const [paidTo, setPaidTo] = useState('')
  const [paidBy, setPaidBy] = useState<PaidBy>('cashier')
  const [ownerName, setOwnerName] = useState('')
  const [category, setCategory] = useState(categories[0] ?? 'General')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveVoucherResult, { ok: true }> | null>(null)

  const isReimb = category.trim().toLowerCase().replace(/\s+/g, '_') === 'owner_reimbursement'
  const canSave =
    !saving &&
    parseMoney(amount.trim()) !== null &&
    Number(amount.trim()) > 0 &&
    paidTo.trim() !== '' &&
    (paidBy === 'cashier' || ownerName.trim() !== '')

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveVoucher({
        date,
        amount: amount.trim(),
        paidTo: paidTo.trim(),
        paidBy,
        ownerName: ownerName.trim(),
        category: category.trim(),
        note: note.trim(),
      })
      if (res.ok) setSaved(res)
      else setError(res.error)
    } catch {
      setError('Could not reach the server — the voucher was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  function startAnother() {
    setSaved(null)
    setAmount('')
    setPaidTo('')
    setOwnerName('')
    setCategory(categories[0] ?? 'General')
    setNote('')
    setError(null)
    setDate(todayLocal())
  }

  if (saved !== null) {
    const v = saved.voucher
    return (
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Voucher recorded</h2>
        <p className="mt-2 text-2xl font-bold tabular-nums text-stone-900">{formatMoneyString(v.amount)}</p>
        <p className="mt-1 text-[15px] text-stone-900">
          to {v.paid_to} · {v.category}
        </p>
        <p className="mt-0.5 text-sm text-stone-500">
          {fmtDate(v.voucher_date)} ·{' '}
          {v.paid_by === 'owner' ? (
            <span className="font-medium text-amber-800">
              paid by {v.owner_name} from pocket — not in the drawer math; lands in owners owed
            </span>
          ) : (
            'paid by the cashier from the drawer — lands on the day’s ladder'
          )}
        </p>
        <button
          type="button"
          onClick={startAnother}
          className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          Record another
        </button>
      </section>
    )
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Cash voucher</h2>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Amount</span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${numCls} w-full text-right`}
            />
          </label>
        </div>
        <label className="block">
          <span className={fieldLabelCls}>Paid to</span>
          <input
            list={isReimb ? 'kb-owner-names' : 'kb-paid-to'}
            value={paidTo}
            onChange={(e) => setPaidTo(e.target.value)}
            placeholder={isReimb ? 'which owner is being reimbursed' : 'pick from history or add new'}
            className={inputCls}
            maxLength={120}
          />
        </label>
        <div>
          <span className={fieldLabelCls}>Paid by</span>
          <div className="flex gap-2">
            {(['cashier', 'owner'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPaidBy(p)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                  paidBy === p
                    ? 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-stone-300 text-stone-600 hover:border-emerald-400'
                }`}
              >
                {p === 'cashier' ? 'Cashier (drawer)' : 'Owner (own pocket)'}
              </button>
            ))}
          </div>
          {paidBy === 'owner' && (
            <p className="mt-1 text-xs text-amber-800">
              Owner-funded never touches the drawer math — it opens a debt the restaurant owes back.
            </p>
          )}
        </div>
        {paidBy === 'owner' && (
          <label className="block">
            <span className={fieldLabelCls}>Which owner paid</span>
            <input
              list="kb-owner-names"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="pick — free text breaks the netting"
              className={inputCls}
              maxLength={120}
            />
          </label>
        )}
        <label className="block">
          <span className={fieldLabelCls}>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {isReimb && (
            <span className="mt-1 block text-xs text-stone-500">
              Reimbursement: cashier pays an owner back from the drawer — one log, netted in owners owed.
            </span>
          )}
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
        </label>
      </div>
      <datalist id="kb-owner-names">
        {ownerNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id="kb-paid-to">
        {paidToNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

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
        {saving ? 'Saving…' : 'Record voucher'}
      </button>
    </section>
  )
}
