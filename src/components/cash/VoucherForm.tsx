'use client'

// Cash voucher: who was paid, how much, and — load-bearing — WHO PAID.
// Cashier-paid leaves the drawer and lands on the day's ladder; owner-paid
// NEVER touches the drawer math and instead opens a debt in owners_owed.
// Names come from pickers, because "Asheel" and "Asheel Sir" would never net
// against each other.
//
// SEVERAL PAYMENTS, ONE SITTING. A cashier pays four small things in an
// evening and used to make four trips through this form. The date is the
// header; everything that identifies a payment stays per line.
//
// EACH PAYMENT IS A CARD, not a table row. Seven controls across a row is
// unusable on the phone this is filled in on, and one question at a time
// still rules inside each card.
//
// N VOUCHERS, N DOCUMENT NUMBERS. A batch is a convenience of ENTRY, not a
// document: three payments are three payments, individually voidable and
// individually cited by an accountant later.

import { useState } from 'react'
import type { MoneyAccount, PaidBy, SaveVouchersResult } from '@/lib/types'
import { saveVouchers } from '@/server/cash-actions'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls, selectCls } from '@/components/ui'
import { useBusinessToday } from '@/components/BusinessDay'

type Kind = 'expense' | 'stock' | 'labour'
type Line = {
  key: number
  accountId: string
  amount: string
  paidTo: string
  paidBy: PaidBy
  ownerName: string
  category: string
  note: string
  kind: Kind
}

const KINDS = [
  { v: 'expense', label: 'An expense', hint: 'gas, repairs, a courier — anything the business spends on' },
  { v: 'stock', label: 'Goods for the kitchen', hint: 'vegetables, ice, a forgotten ingredient — it will be cooked' },
  { v: 'labour', label: "A day hand's wages", hint: 'unloading, dishwashing, an extra pair of hands tonight' },
] as const

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
  const businessToday = useBusinessToday()
  const newLine = (key: number): Line => ({
    key,
    accountId: '',
    amount: '',
    paidTo: '',
    paidBy: 'cashier',
    ownerName: '',
    category: categories[0] ?? 'General',
    note: '',
    kind: 'expense',
  })

  const [date, setDate] = useState(businessToday)
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveVouchersResult, { ok: true }> | null>(null)

  const patch = (key: number, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [newLine(nextKey)] : ls.filter((l) => l.key !== key)))

  const isReimb = (l: Line) => l.category.trim().toLowerCase().replace(/\s+/g, '_') === 'owner_reimbursement'
  const lineOk = (l: Line) =>
    parseMoney(l.amount.trim()) !== null &&
    Number(l.amount.trim()) > 0 &&
    l.paidTo.trim() !== '' &&
    l.accountId !== '' &&
    (l.paidBy === 'cashier' || l.ownerName.trim() !== '')
  const canSave = !saving && lines.every(lineOk)
  const runningTotal = lines.reduce((n, l) => n + (Number(l.amount.trim()) || 0), 0).toFixed(2)

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveVouchers({
        date,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          amount: l.amount.trim(),
          paidTo: l.paidTo.trim(),
          paidBy: l.paidBy,
          ownerName: l.ownerName.trim(),
          category: l.category.trim(),
          note: l.note.trim(),
          isStockPurchase: l.kind === 'stock',
          isCasualLabour: l.kind === 'labour',
        })),
      })
      if (res.ok) setSaved(res)
      else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  function startAnother() {
    setSaved(null)
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
    setDate(businessToday)
  }

  if (saved !== null) {
    return (
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>
          {saved.vouchers.length === 1 ? 'Voucher recorded' : `${saved.vouchers.length} vouchers recorded`}
        </h2>
        <p className="mt-2 text-2xl font-bold tabular-nums text-stone-900">
          {formatMoneyString(saved.total)}
        </p>
        <p className="mt-0.5 text-sm text-stone-500">{fmtDate(saved.vouchers[0].voucher_date)}</p>
        <ul className="mt-3 divide-y divide-rule-soft border-t border-stone-100">
          {saved.vouchers.map((v) => (
            <li key={v.id} className="py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[15px] text-stone-900">
                  {v.paid_to} · {v.category}
                </span>
                <span className="shrink-0 tabular-nums text-sm font-semibold text-stone-900">
                  {formatMoneyString(v.amount)}
                </span>
              </div>
              <p className="text-xs text-stone-500">
                {/* every voucher keeps its OWN number — a batch is entry, not a document */}
                {v.doc_no !== null && <span className="font-mono">{v.doc_no}</span>}
                {v.doc_no !== null && ' · '}
                {v.paid_by === 'owner' ? (
                  <span className="font-medium text-amber-800">
                    paid by {v.owner_name} from pocket — not in the drawer math; lands in owners owed
                  </span>
                ) : (
                  'paid by the cashier from the drawer — lands on the day’s ladder'
                )}
              </p>
            </li>
          ))}
        </ul>
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
      <h2 className={sectionHeadCls}>Cash vouchers</h2>

      <label className="mt-3 block sm:w-44">
        <span className={fieldLabelCls}>Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
      </label>

      <div className="mt-3 space-y-3">
        {lines.map((l, i) => (
          <div key={l.key} className="rounded-xl border border-rule bg-cell p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Payment {i + 1}
              </span>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(l.key)}
                  className="text-sm text-stone-400 hover:text-red-700"
                  aria-label={`Remove payment ${i + 1}`}
                >
                  ✕
                </button>
              )}
            </div>

            <div className="mt-2 space-y-3">
              <label className="block">
                <span className={fieldLabelCls}>Amount</span>
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={l.amount}
                  onChange={(e) => patch(l.key, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                  className={`${numCls} w-full text-right`}
                />
              </label>

              <label className="block">
                <span className={fieldLabelCls}>Paid to</span>
                <input
                  list={isReimb(l) ? 'kb-owner-names' : 'kb-paid-to'}
                  value={l.paidTo}
                  onChange={(e) => patch(l.key, { paidTo: e.target.value })}
                  placeholder={isReimb(l) ? 'which owner is being reimbursed' : 'pick from history or add new'}
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
                      onClick={() => patch(l.key, { paidBy: p })}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                        l.paidBy === p
                          ? 'border-emerald-700 bg-emerald-700 text-white'
                          : 'border-stone-300 text-stone-600 hover:border-emerald-400'
                      }`}
                    >
                      {p === 'cashier' ? 'Cashier (drawer)' : 'Owner (own pocket)'}
                    </button>
                  ))}
                </div>
                {l.paidBy === 'owner' && (
                  <p className="mt-1 text-xs text-amber-800">
                    Owner-funded never touches the drawer math — it opens a debt the restaurant owes back.
                  </p>
                )}
              </div>

              {l.paidBy === 'owner' && (
                <label className="block">
                  <span className={fieldLabelCls}>Which owner paid</span>
                  <input
                    list="kb-owner-names"
                    value={l.ownerName}
                    onChange={(e) => patch(l.key, { ownerName: e.target.value })}
                    placeholder="pick — free text breaks the netting"
                    className={inputCls}
                    maxLength={120}
                  />
                </label>
              )}

              {/* PER LINE, not shared. "Paid by" says whose money it was; this
                  says which account it actually left, and in one sitting a
                  cashier payment leaves the drawer while an owner-funded one
                  leaves the owner's own account. */}
              <AccountPicker
                accounts={accounts}
                value={l.accountId}
                onChange={(id) => patch(l.key, { accountId: id })}
                label="Paid from"
                hint={l.paidBy === 'owner' ? 'the owner’s own account, not the drawer' : undefined}
              />

              <label className="block">
                <span className={fieldLabelCls}>Category</span>
                <select
                  value={l.category}
                  onChange={(e) => patch(l.key, { category: e.target.value })}
                  className={selectCls}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {isReimb(l) && (
                  <span className="mt-1 block text-xs text-stone-500">
                    Reimbursement: cashier pays an owner back from the drawer — one log, netted in owners owed.
                  </span>
                )}
              </label>

              <label className="block">
                <span className={fieldLabelCls}>Note</span>
                <input
                  value={l.note}
                  onChange={(e) => patch(l.key, { note: e.target.value })}
                  placeholder="optional"
                  className={inputCls}
                  maxLength={300}
                />
              </label>

              {/* ONE QUESTION, THREE ANSWERS — it used to be two independent
                  toggles, and both could be Yes. That put a single amount into
                  cost of goods AND onto the labour line: the same rupee counted
                  twice, in two totals, with nothing on screen looking wrong.
                  They were never independent — a payment is one kind of thing.

                  Why the flags exist at all: a market run paid from the drawer
                  never enters `purchases`, so recorded only as a voucher it
                  drops out of food cost entirely. A day hand paid from the till
                  is a voucher (the drawer must see it) AND labour (the P&L must
                  see it). One payment, one record, read twice. */}
              <div className="rounded-xl border border-amber-300 bg-field p-3">
                <span className="text-[15px] font-medium text-stone-900">What kind of payment was this?</span>
                <div className="mt-2 grid gap-2">
                  {KINDS.map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      aria-pressed={l.kind === o.v}
                      onClick={() => patch(l.key, { kind: o.v })}
                      className={`min-h-[44px] rounded-xl border px-3 py-2 text-left ${
                        l.kind === o.v
                          ? 'border-emerald-700 bg-emerald-700 text-white'
                          : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
                      }`}
                    >
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className={`block text-xs ${l.kind === o.v ? 'text-emerald-50' : 'text-stone-500'}`}>
                        {o.hint}
                      </span>
                    </button>
                  ))}
                </div>
                {l.kind === 'stock' && (
                  <p className="mt-2 rounded-lg border border-rule bg-cell px-2.5 py-2 text-xs text-stone-600">
                    <span className="font-medium">The money counts, the stock does not.</span> This reaches cost
                    of goods, but with no vendor and no item lines it never becomes inventory — it will not show
                    in stock on hand, will not trigger a reorder, and will not appear in slow-moving. If this
                    needs to be tracked as stock, enter it as a purchase bill instead.
                  </p>
                )}
                {l.kind === 'labour' && (
                  <p className="mt-2 rounded-lg border border-rule bg-cell px-2.5 py-2 text-xs text-stone-600">
                    This lands on the P&amp;L&apos;s labour line without a second entry anywhere. The drawer sees
                    the voucher, the labour total sees the wage, and there is only one record to reconcile.
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addLine}
        className="mt-3 rounded-full border border-rule bg-cell px-3.5 py-2 text-sm font-medium text-stone-700 hover:border-stone-400"
      >
        ＋ Add another payment
      </button>

      {lines.length > 1 && (
        <p className="mt-3 text-sm text-stone-600">
          {lines.length} payments ·{' '}
          <span className="font-semibold tabular-nums text-stone-900">{formatMoneyString(runningTotal)}</span>{' '}
          <span className="text-stone-400">— each gets its own voucher number</span>
        </p>
      )}

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
        {saving ? 'Saving…' : lines.length === 1 ? 'Record voucher' : `Record ${lines.length} vouchers`}
      </button>
    </section>
  )
}
