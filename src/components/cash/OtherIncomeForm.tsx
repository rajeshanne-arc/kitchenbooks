'use client'

// Other income: used oil to the biodiesel buyer, scrap, cartons. Oil needs
// its litres — the unit is required with a quantity; the FSSAI expects the
// used-oil reconciliation to add up.

import { useState } from 'react'
import type { MoneyAccount, SaveOtherIncomesResult, Unit } from '@/lib/types'
import { saveOtherIncomes } from '@/server/cash-actions'
import SaveAck from '@/components/SaveAck'
import { formatMoneyString, parseMoney, parseQty } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls, selectCls } from '@/components/ui'
import { useBusinessToday } from '@/components/BusinessDay'

type Line = {
  key: number
  accountId: string
  item: string
  qty: string
  unit: string
  amount: string
  buyer: string
  receivedBy: string
}
const newLine = (key: number): Line => ({
  key,
  accountId: '',
  item: '',
  qty: '',
  unit: '',
  amount: '',
  buyer: '',
  receivedBy: '',
})

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
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveOtherIncomesResult, { ok: true }> | null>(null)

  const patch = (key: number, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [newLine(nextKey)] : ls.filter((l) => l.key !== key)))

  // A quantity requires its unit and vice versa — oil is sold in litres and
  // the FSSAI expects the reconciliation.
  const lineOk = (l: Line) => {
    const qtyOk = l.qty.trim() === '' || (parseQty(l.qty.trim()) !== null && Number(l.qty.trim()) > 0)
    const unitOk = (l.qty.trim() === '') === (l.unit === '')
    return (
      l.item.trim() !== '' &&
      l.accountId !== '' &&
      parseMoney(l.amount.trim()) !== null &&
      Number(l.amount.trim()) > 0 &&
      qtyOk &&
      unitOk
    )
  }
  const canSave = !saving && lines.every(lineOk)
  const runningTotal = lines.reduce((n, l) => n + (Number(l.amount.trim()) || 0), 0).toFixed(2)

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveOtherIncomes({
        date,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          item: l.item.trim(),
          qty: l.qty.trim(),
          unit: l.unit,
          amount: l.amount.trim(),
          buyer: l.buyer.trim(),
          receivedBy: l.receivedBy.trim(),
        })),
      })
      if (res.ok) {
        setSaved(res)
        resetForNext()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — the income was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  /** Reset for the next entry, keeping what carries: the DATE stays. A
   *  day's sundries are written up together — a scrap dealer, a vending
   *  commission and a staff sale on one afternoon. */
  function resetForNext() {
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
  }

  return (
    <div className="space-y-4">
      {saved !== null && <IncomeAck saved={saved} onDismiss={() => setSaved(null)} />}
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Other income</h2>
      <label className="mt-3 block sm:w-44">
        <span className={fieldLabelCls}>Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
      </label>

      {/* A CARD PER RECEIPT — seven controls across a row is unusable on a
          phone. The BUYER is per line, argued: a scrap dealer taking three
          things really is one buyer, but a day's sundries just as often means
          a dealer, a vending commission and a staff sale. */}
      <div className="mt-3 space-y-3">
        {lines.map((l, idx) => (
          <div key={l.key} className="rounded-xl border border-rule bg-cell p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Receipt {idx + 1}
              </span>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(l.key)}
                  className="text-sm text-stone-400 hover:text-red-700"
                  aria-label={`Remove receipt ${idx + 1}`}
                >
                  ✕
                </button>
              )}
            </div>
            <div className="mt-2 space-y-3">
              <label className="block">
                <span className={fieldLabelCls}>Amount received</span>
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={l.amount}
                  onChange={(e) => patch(l.key, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                  className={`${numCls} w-full text-right`}
                />
              </label>
              {/* the drawer and the bank are different money */}
              <AccountPicker
                accounts={accounts}
                value={l.accountId}
                onChange={(id) => patch(l.key, { accountId: id })}
                label="Received into"
                required
              />
              <label className="block">
                <span className={fieldLabelCls}>Item</span>
                <select
                  value={l.item}
                  onChange={(e) => patch(l.key, { item: e.target.value })}
                  className={selectCls}
                >
                  <option value="">—</option>
                  {items.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={fieldLabelCls}>Quantity</span>
                  <input
                    inputMode="decimal"
                    placeholder="e.g. 12.5"
                    value={l.qty}
                    onChange={(e) => patch(l.key, { qty: e.target.value.replace(/[^\d.]/g, '') })}
                    className={`${numCls} w-full`}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabelCls}>
                    Unit {l.qty.trim() !== '' && <span className="text-red-600">*</span>}
                  </span>
                  <select
                    value={l.unit}
                    onChange={(e) => patch(l.key, { unit: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">—</option>
                    {units.map((u) => (
                      <option key={u.code} value={u.code}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {l.qty.trim() !== '' && l.unit === '' && (
                <p className="text-xs font-medium text-amber-800">
                  A quantity needs its unit — oil is sold in litres; the FSSAI expects the reconciliation.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={fieldLabelCls}>Buyer</span>
                  <input
                    list="kb-income-buyers"
                    value={l.buyer}
                    onChange={(e) => patch(l.key, { buyer: e.target.value })}
                    placeholder="pick or add"
                    className={inputCls}
                    maxLength={120}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabelCls}>Received by</span>
                  <input
                    list="kb-income-receivers"
                    value={l.receivedBy}
                    onChange={(e) => patch(l.key, { receivedBy: e.target.value })}
                    placeholder="pick or add"
                    className={inputCls}
                    maxLength={120}
                  />
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>

      <datalist id="kb-income-buyers">
        {buyerNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <button
        type="button"
        onClick={addLine}
        className="mt-3 rounded-full border border-rule bg-cell px-3.5 py-2 text-sm font-medium text-stone-700 hover:border-stone-400"
      >
        ＋ Add another receipt
      </button>

      {lines.length > 1 && (
        <p className="mt-3 text-sm text-stone-600">
          {lines.length} receipts ·{' '}
          <span className="font-semibold tabular-nums text-stone-900">{formatMoneyString(runningTotal)}</span>
        </p>
      )}

      <datalist id="kb-income-receivers">
        {receiverNames.map((n) => (
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
        {saving ? 'Saving…' : lines.length === 1 ? 'Record income' : `Record ${lines.length} receipts`}
      </button>
    </section>
    </div>
  )
}

/**
 * A RECEIPT WITH NO QUANTITY IS A RUPEE FIGURE AND NOTHING ELSE. Used oil is
 * sold by the litre and FSSAI expects that reconciliation, so a sale recorded
 * only in money cannot answer the one question anybody will ask about it.
 * Some sundries genuinely have no quantity — a vending commission — so this
 * is said, never refused.
 */
function IncomeAck({
  saved,
  onDismiss,
}: {
  saved: Extract<SaveOtherIncomesResult, { ok: true }>
  onDismiss: () => void
}) {
  const noQty = saved.rows.filter((r) => r.qty === null)
  return (
    <SaveAck
      onDismiss={onDismiss}
      headline={
        <>
          {saved.rows.length === 1 ? 'Income recorded' : `${saved.rows.length} receipts recorded`} —{' '}
          <span className="tabular-nums">{formatMoneyString(saved.total)}</span>
        </>
      }
      sub={`${fmtDate(saved.rows[0].income_date)} · joins the day’s ladder as cash in`}
      missing={
        noQty.length > 0
          ? [
              {
                verdict: 'no quantity',
                text: `${noQty
                  .map((r) => r.item)
                  .join(', ')} — recorded in money only. Anything sold by volume or weight (used oil above all) is reconciled on the quantity, and a rupee figure alone cannot answer that.`,
              },
            ]
          : undefined
      }
    >
      <ul className="divide-y divide-emerald-200/60 border-y border-emerald-200/60">
        {saved.rows.map((i) => (
          <li key={i.id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0">
              <span className="block truncate text-stone-900">
                {i.item}
                {i.qty !== null && (
                  <>
                    {' '}
                    · {i.qty} {i.unit}
                  </>
                )}
              </span>
              <span className="block text-xs text-stone-500">
                {i.buyer !== null && <>to {i.buyer}</>}
                {i.buyer !== null && i.received_by !== null && ' · '}
                {i.received_by !== null && <>received by {i.received_by}</>}
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-stone-900">{formatMoneyString(i.amount)}</span>
          </li>
        ))}
      </ul>
    </SaveAck>
  )
}
