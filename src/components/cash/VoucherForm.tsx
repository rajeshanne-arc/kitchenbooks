'use client'

// Cash voucher: who was paid, how much, and — load-bearing — WHO PAID.
// Cashier-paid leaves the drawer and lands on the day's ladder; owner-paid
// NEVER touches the drawer math and instead opens a debt in owners_owed.
// Names come from pickers, because “Asheel” and “Asheel Sir” would never
// net against each other.

import { useState } from 'react'
import type { MoneyAccount, PaidBy, SaveVoucherResult } from '@/lib/types'
import { saveVoucher } from '@/server/cash-actions'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls, selectCls } from '@/components/ui'

export default function VoucherForm({
  ownerNames,
  categories,
  paidToNames = [],
  accounts,
}: {
  ownerNames: string[]
  /** ACTIVE voucher_category list values (LAW 2) — display form; the save normalizes */
  categories: string[]
  paidToNames?: string[]
  accounts: MoneyAccount[]
}) {
  const [date, setDate] = useState(todayLocal)
  const [amount, setAmount] = useState('')
  const [paidTo, setPaidTo] = useState('')
  const [paidBy, setPaidBy] = useState<PaidBy>('cashier')
  const [accountId, setAccountId] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [category, setCategory] = useState(categories[0] ?? 'General')
  const [note, setNote] = useState('')
  // one question, three answers — the two booleans it derives were once two
  // toggles that could both be Yes, which double-counted the same rupee
  const [kind, setKind] = useState<'expense' | 'stock' | 'labour'>('expense')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveVoucherResult, { ok: true }> | null>(null)

  const isReimb = category.trim().toLowerCase().replace(/\s+/g, '_') === 'owner_reimbursement'
  const canSave =
    !saving &&
    parseMoney(amount.trim()) !== null &&
    Number(amount.trim()) > 0 &&
    paidTo.trim() !== '' &&
    accountId !== '' &&
    (paidBy === 'cashier' || ownerName.trim() !== '')

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveVoucher({
        accountId,
        date,
        amount: amount.trim(),
        paidTo: paidTo.trim(),
        paidBy,
        ownerName: ownerName.trim(),
        category: category.trim(),
        note: note.trim(),
        isStockPurchase: kind === 'stock',
        isCasualLabour: kind === 'labour',
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
    setAccountId('')
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
        {/* “Paid by” says whose money it was; this says which account it
            actually left. Owner-funded is the owner's own account — the
            drawer stays untouched and owners_owed carries the other half. */}
        <AccountPicker
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          label="Paid from"
          hint={paidBy === 'owner' ? 'the owner’s own account, not the drawer' : undefined}
        />
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

      {/* ONE QUESTION, THREE ANSWERS — it used to be two independent
          toggles, and both could be Yes. That put a single amount into cost
          of goods AND onto the labour line: the same rupee counted twice,
          in two different totals, with nothing on screen looking wrong.
          They were never independent — a payment is one kind of thing —
          and asking it as one question makes that structural instead of a
          rule somebody has to remember.

          Why the flags exist at all: a market run paid from the drawer
          never enters `purchases`, so recorded only as a voucher it drops
          out of food cost entirely. A day hand paid from the till is a
          voucher (the drawer must see it) AND labour (the P&L must see
          it). One payment, one record, read twice. */}
      <div className="mt-3 rounded-xl border border-amber-300 bg-field p-3">
        <span className="text-[15px] font-medium text-stone-900">What kind of payment was this?</span>
        <div className="mt-2 grid gap-2">
          {(
            [
              { v: 'expense', label: 'An expense', hint: 'gas, repairs, a courier — anything the business spends on' },
              { v: 'stock', label: 'Goods for the kitchen', hint: 'vegetables, ice, a forgotten ingredient — it will be cooked' },
              { v: 'labour', label: "A day hand's wages", hint: 'unloading, dishwashing, an extra pair of hands tonight' },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              aria-pressed={kind === o.v}
              onClick={() => setKind(o.v)}
              className={`min-h-[44px] rounded-xl border px-3 py-2 text-left ${
                kind === o.v
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
              }`}
            >
              <span className="block text-sm font-medium">{o.label}</span>
              <span className={`block text-xs ${kind === o.v ? 'text-emerald-50' : 'text-stone-500'}`}>
                {o.hint}
              </span>
            </button>
          ))}
        </div>
        {kind === 'stock' && (
          <p className="mt-2 rounded-lg border border-rule bg-cell px-2.5 py-2 text-xs text-stone-600">
            <span className="font-medium">The money counts, the stock does not.</span> This reaches cost of
            goods, but with no vendor and no item lines it never becomes inventory — it will not show in stock
            on hand, will not trigger a reorder, and will not appear in slow-moving. If this needs to be
            tracked as stock, enter it as a purchase bill instead.
          </p>
        )}
        {kind === 'labour' && (
          <p className="mt-2 rounded-lg border border-rule bg-cell px-2.5 py-2 text-xs text-stone-600">
            This lands on the P&amp;L&apos;s labour line without a second entry anywhere. The drawer sees the
            voucher, the labour total sees the wage, and there is only one record to reconcile.
          </p>
        )}
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
