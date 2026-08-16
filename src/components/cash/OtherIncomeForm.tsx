'use client'

// Other income: used oil to the biodiesel buyer, scrap, cartons. Oil needs
// its litres — the unit is required with a quantity; the FSSAI expects the
// used-oil reconciliation to add up.

import { useState } from 'react'
import type { MoneyAccount, SaveOtherIncomeResult, Unit } from '@/lib/types'
import { saveOtherIncome } from '@/server/cash-actions'
import { formatMoneyString, parseMoney, parseQty } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls, selectCls } from '@/components/ui'
import { useBusinessToday } from '@/components/BusinessDay'

export default function OtherIncomeForm({
  units,
  accounts,
  items = [],
  buyerNames = [],
  receiverNames = [],
}: {
  units: Unit[]
  accounts: MoneyAccount[]
  /** ACTIVE other_income_item list values (LAW 2) */
  items?: string[]
  buyerNames?: string[]
  receiverNames?: string[]
}) {
  const businessToday = useBusinessToday()
  const [date, setDate] = useState(businessToday)
  const [item, setItem] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  const [buyer, setBuyer] = useState('')
  const [receivedBy, setReceivedBy] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveOtherIncomeResult, { ok: true }> | null>(null)

  const qtyOk = qty.trim() === '' || (parseQty(qty.trim()) !== null && Number(qty.trim()) > 0)
  const unitOk = (qty.trim() === '') === (unit === '') || (qty.trim() !== '' && unit !== '')
  const canSave =
    !saving &&
    item.trim() !== '' &&
    accountId !== '' &&
    parseMoney(amount.trim()) !== null &&
    Number(amount.trim()) > 0 &&
    qtyOk &&
    unitOk

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveOtherIncome({
        date,
        item: item.trim(),
        qty: qty.trim(),
        unit,
        amount: amount.trim(),
        accountId,
        buyer: buyer.trim(),
        receivedBy: receivedBy.trim(),
      })
      if (res.ok) setSaved(res)
      else setError(res.error)
    } catch {
      setError('Could not reach the server — the income was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  function startAnother() {
    setSaved(null)
    setItem('')
    setQty('')
    setUnit('')
    setAmount('')
    setAccountId('')
    setBuyer('')
    setReceivedBy('')
    setError(null)
    setDate(businessToday)
  }

  if (saved !== null) {
    const i = saved.income
    return (
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Income recorded</h2>
        <p className="mt-2 text-2xl font-bold tabular-nums text-stone-900">{formatMoneyString(i.amount)}</p>
        <p className="mt-1 text-[15px] text-stone-900">
          {i.item}
          {i.qty !== null && (
            <>
              {' '}
              · {i.qty} {i.unit}
            </>
          )}
          {i.buyer !== null && <> · to {i.buyer}</>}
        </p>
        <p className="mt-0.5 text-sm text-stone-500">
          {fmtDate(i.income_date)}
          {i.received_by !== null && <> · received by {i.received_by}</>} · joins the day’s ladder as cash in
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
      <h2 className={sectionHeadCls}>Other income</h2>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Amount received</span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${numCls} w-full text-right`}
            />
          </label>
        </div>
        {/* right under the amount: the drawer and the bank are different money */}
        <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} label="Received into" required />
        <label className="block">
          <span className={fieldLabelCls}>Item</span>
          <select value={item} onChange={(e) => setItem(e.target.value)} className={selectCls}>
            <option value="">—</option>
            {items.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-stone-400">
            Missing something? Owners and managers add values in Settings → Lists.
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Quantity</span>
            <input
              inputMode="decimal"
              placeholder="e.g. 12.5"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${numCls} w-full`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Unit {qty.trim() !== '' && <span className="text-red-600">*</span>}</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={selectCls}>
              <option value="">—</option>
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {qty.trim() !== '' && unit === '' && (
          <p className="text-xs font-medium text-amber-800">
            A quantity needs its unit — oil is sold in litres; the FSSAI expects the reconciliation.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Buyer</span>
            <input list="kb-income-buyers" value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="pick or add" className={inputCls} maxLength={120} />
            <datalist id="kb-income-buyers">
              {buyerNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Received by</span>
            <input
              list="kb-income-receivers"
              value={receivedBy}
              onChange={(e) => setReceivedBy(e.target.value)}
              placeholder="pick or add"
              className={inputCls}
              maxLength={120}
            />
            <datalist id="kb-income-receivers">
              {receiverNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
        </div>
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
        {saving ? 'Saving…' : 'Record income'}
      </button>
    </section>
  )
}
