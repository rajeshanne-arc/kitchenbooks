'use client'

// Expenses — non-drawer money only. Category and paid-via come from the
// lists (LAW 2), and paid-via NEVER offers till cash: paid from the
// drawer? that is a Cash Voucher, and it belongs on the Cash page where
// the ladder can see it. The server refuses 'Cash' by name.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ExpenseRow, MoneyAccount, RecurringExpenseOffer, SaveExpensesResult } from '@/lib/types'
import { saveExpenses, voidExpense } from '@/server/expenses-actions'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
import {
  cardCls,
  docNoCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'
import { toast } from '@/components/Toasts'
import { useBusinessToday } from '@/components/BusinessDay'

type Line = {
  key: number
  accountId: string
  category: string
  payee: string
  amount: string
  paidVia: string
  note: string
}
const newLine = (key: number): Line => ({
  key,
  accountId: '',
  category: '',
  payee: '',
  amount: '',
  paidVia: '',
  note: '',
})

export default function ExpensesClient({
  accounts,
  categories,
  modes,
  payeeNames,
  rows,
  recurring,
}: {
  accounts: MoneyAccount[]
  categories: string[]
  /** payment_mode list values — 'Cash' is filtered out here AND refused server-side */
  modes: string[]
  payeeNames: string[]
  rows: ExpenseRow[]
  /** last month's bills, offered back at last month's figure */
  recurring: RecurringExpenseOffer[]
}) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const nonCashModes = modes.filter((m) => m.toLowerCase() !== 'cash')
  const [date, setDate] = useState(businessToday)
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveExpensesResult, { ok: true }> | null>(null)

  const patch = (key: number, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [newLine(nextKey)] : ls.filter((l) => l.key !== key)))

  const lineOk = (l: Line) =>
    l.category !== '' &&
    l.paidVia !== '' &&
    l.accountId !== '' &&
    parseMoney(l.amount.trim()) !== null &&
    Number(l.amount.trim()) > 0
  const canSave = !saving && lines.every(lineOk)
  const runningTotal = lines.reduce((n, l) => n + (Number(l.amount.trim()) || 0), 0).toFixed(2)

  // Tapping a recurring bill fills the form and stops. The figure is last
  // month's, sitting in an editable field — the manager confirms or corrects
  // it and presses save like any other expense. Nothing is written by the tap.
  function offerRecurring(o: RecurringExpenseOffer) {
    // Fills the FIRST empty line, or adds one. The figure is last month's,
    // sitting in an editable field — the manager confirms or corrects it and
    // presses save like any other expense. Nothing is written by the tap.
    const fill: Partial<Line> = {
      category: o.category,
      amount: o.last_amount,
      ...(o.payee !== null ? { payee: o.payee } : {}),
      ...(o.paid_via !== null && o.paid_via.toLowerCase() !== 'cash' ? { paidVia: o.paid_via } : {}),
    }
    setLines((ls) => {
      const i = ls.findIndex((l) => l.category === '' && l.amount.trim() === '')
      if (i === -1) return [...ls, { ...newLine(nextKey), ...fill }]
      const copy = [...ls]
      copy[i] = { ...copy[i], ...fill }
      return copy
    })
    setNextKey((k) => k + 1)
    setError(null)
  }

  const outstanding = recurring.filter((o) => !o.done_this_month)

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveExpenses({
        date,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          category: l.category,
          payee: l.payee.trim(),
          amount: l.amount.trim(),
          paidVia: l.paidVia,
          note: l.note.trim(),
        })),
      })
      if (res.ok) {
        setSaved(res)
        setLines([newLine(nextKey)])
        setNextKey((k) => k + 1)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the expense was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  async function onVoid(id: string) {
    if (busy !== null) return
    setBusy(id)
    try {
      const res = await voidExpense(id)
      if (res.ok) {
        toast('Expense voided')
        router.refresh()
      } else {
        toast(res.error, 'error')
      }
    } catch {
      toast('Could not reach the server — nothing was voided.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {recurring.length > 0 && (
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Last month&apos;s bills</h2>
            <span className="text-xs text-stone-400">
              {outstanding.length === 0
                ? 'all recorded this month'
                : `${outstanding.length} not recorded yet this month`}
            </span>
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Tap one to fill the form with last month&apos;s figure — then correct it and save.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {recurring.map((o) => (
              <button
                key={o.category}
                type="button"
                onClick={() => offerRecurring(o)}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                  o.done_this_month
                    ? 'border-rule bg-stone-50 text-stone-500 hover:border-stone-400'
                    : 'border-amber-300 bg-field text-stone-900 hover:border-emerald-500'
                }`}
              >
                <span className="block text-sm font-medium">
                  {o.category}
                  {o.done_this_month && (
                    <span className="ml-1.5 text-[11px] font-normal text-emerald-700">✓ done</span>
                  )}
                </span>
                <span className="block font-mono text-xs tabular-nums">
                  {formatMoneyString(o.last_amount)}
                  <span className="ml-1 font-sans text-stone-500">last month</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Record an expense</h2>
        {saved !== null && (
          <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-stone-800">
            {saved.expenses.length === 1
              ? `${saved.expenses[0].category} · ${formatMoneyString(saved.expenses[0].amount)} via ${saved.expenses[0].paid_via} recorded`
              : `${saved.expenses.length} expenses recorded — ${formatMoneyString(saved.total)}`}
            {saved.expenses.length > 1 && (
              <ul className="mt-1.5 space-y-0.5">
                {saved.expenses.map((e) => (
                  <li key={e.id} className="text-xs text-stone-600">
                    {/* each receipt keeps its OWN number — a batch is entry, not a document */}
                    {e.doc_no !== null && <span className={docNoCls}>{e.doc_no}</span>} {e.category} ·{' '}
                    {formatMoneyString(e.amount)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <label className="mt-3 block sm:w-44">
          <span className={fieldLabelCls}>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
        </label>

        {/* A CARD PER RECEIPT, not a table row: six controls across a row is
            unusable on a phone, and one question at a time still rules inside
            each card. */}
        <div className="mt-3 space-y-3">
          {lines.map((l, i) => (
            <div key={l.key} className="rounded-xl border border-rule bg-cell p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  Expense {i + 1}
                </span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    className="text-sm text-stone-400 hover:text-red-700"
                    aria-label={`Remove expense ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="mt-2 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={fieldLabelCls}>Category</span>
                    <select
                      value={l.category}
                      onChange={(e) => patch(l.key, { category: e.target.value })}
                      className={selectCls}
                    >
                      <option value="">—</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={fieldLabelCls}>Amount (₹)</span>
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={l.amount}
                      onChange={(e) => patch(l.key, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                      className={`${numCls} w-full text-right`}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={fieldLabelCls}>Paid to</span>
                    <input
                      list="kb-expense-payees"
                      value={l.payee}
                      onChange={(e) => patch(l.key, { payee: e.target.value })}
                      placeholder="pick or add"
                      className={inputCls}
                      maxLength={120}
                    />
                  </label>
                  <label className="block">
                    <span className={fieldLabelCls}>Paid via</span>
                    <select
                      value={l.paidVia}
                      onChange={(e) => patch(l.key, { paidVia: e.target.value })}
                      className={selectCls}
                    >
                      <option value="">—</option>
                      {nonCashModes.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs text-amber-800">
                      Paid from the drawer? That is a Cash Voucher — record it on the Cash page instead.
                    </span>
                  </label>
                </div>
                {/* "Paid via" is the instrument, this is the account the money
                    left. PER LINE, argued rather than inherited: two receipts
                    entered in one sitting are routinely paid from two
                    different accounts. Never the drawer — that is a Cash
                    Voucher, refused server-side. */}
                <AccountPicker
                  accounts={accounts}
                  value={l.accountId}
                  onChange={(id) => patch(l.key, { accountId: id })}
                  label="Paid from"
                />
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
              </div>
            </div>
          ))}
        </div>

        <datalist id="kb-expense-payees">
          {payeeNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <button
          type="button"
          onClick={addLine}
          className="mt-3 rounded-full border border-rule bg-cell px-3.5 py-2 text-sm font-medium text-stone-700 hover:border-stone-400"
        >
          ＋ Add another expense
        </button>

        {lines.length > 1 && (
          <p className="mt-3 text-sm text-stone-600">
            {lines.length} expenses ·{' '}
            <span className="font-semibold tabular-nums text-stone-900">{formatMoneyString(runningTotal)}</span>{' '}
            <span className="text-stone-400">— each gets its own expense number</span>
          </p>
        )}

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
          {saving ? 'Saving…' : lines.length === 1 ? 'Record expense' : `Record ${lines.length} expenses`}
        </button>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Recent expenses</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nothing yet. Rent, electricity, repairs — the money that isn’t food or wages.</p>
        ) : (
          <ul className="mt-1 divide-y divide-rule-soft">
            {rows.map((r) => (
              <li key={r.id} className={`flex items-center justify-between gap-3 py-2.5 ${r.is_reversal ? 'opacity-60' : ''}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-stone-900">
                    {r.category}
                    {r.payee !== null && ` · ${r.payee}`}
                    {r.is_reversal && ' · reversal'}
                    {r.is_voided && (
                      <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                        voided
                      </span>
                    )}
                  </span>
                  {r.doc_no !== null && <span className={`block ${docNoCls}`}>{r.doc_no}</span>}
                  <span className="block text-xs text-stone-500">
                    {fmtDate(r.expense_date)} · {r.paid_via}
                    {r.entered_by !== null && ` · by ${r.entered_by}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-sm font-semibold text-stone-900">{formatMoneyString(r.amount)}</span>
                  {!r.is_reversal && !r.is_voided && (
                    <button
                      type="button"
                      onClick={() => void onVoid(r.id)}
                      disabled={busy !== null}
                      className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-500 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                    >
                      {busy === r.id ? '…' : 'Void'}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
