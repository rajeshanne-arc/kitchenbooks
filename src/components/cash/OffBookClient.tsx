'use client'

// Off-book orders: sales that never touched the POS. Payment mode comes
// from the list (LAW 2); CASH off-book feeds the day-close ladder through
// the view — record it here, and the drawer math already expects it.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OffBookRow, SaveOffBookResult } from '@/lib/types'
import { saveOffBook, voidOffBook } from '@/server/cashier-actions'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, selectCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function OffBookClient({ modes, rows }: { modes: string[]; rows: OffBookRow[] }) {
  const router = useRouter()
  const [date, setDate] = useState(todayLocal)
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState(modes.includes('Cash') ? 'Cash' : '')
  const [note, setNote] = useState('')
  const [customer, setCustomer] = useState('')
  const [receivedInto, setReceivedInto] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveOffBookResult, { ok: true }> | null>(null)

  const canSave = !saving && mode !== '' && parseMoney(amount.trim()) !== null && Number(amount.trim()) > 0

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveOffBook({
        date,
        description: description.trim(),
        amount: amount.trim(),
        paymentMode: mode,
        note: note.trim(),
        customer: customer.trim(),
        receivedInto: receivedInto.trim(),
      })
      if (res.ok) {
        setSaved(res)
        setDescription('')
        setAmount('')
        setNote('')
        setCustomer('')
        setReceivedInto('')
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the order was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  async function onVoid(id: string) {
    if (busy !== null) return
    setBusy(id)
    try {
      const res = await voidOffBook(id)
      if (res.ok) {
        toast('Off-book order voided')
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
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Record an off-book order</h2>
        {saved !== null && (
          <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-stone-800">
            {formatMoneyString(saved.order.amount)} · {saved.order.payment_mode} on {fmtDate(saved.order.order_date)}{' '}
            recorded{saved.order.payment_mode === 'Cash' && ' — it will sit on that day’s ladder'}
          </p>
        )}
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Amount (₹)</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                className={`${numCls} w-full text-right`}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Paid by</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)} className={selectCls}>
                <option value="">—</option>
                {modes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className={fieldLabelCls}>Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="party order, counter sale…" className={inputCls} maxLength={200} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Customer</span>
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="who bought it"
                className={inputCls}
                maxLength={120}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Received into</span>
              <input
                value={receivedInto}
                onChange={(e) => setReceivedInto(e.target.value)}
                placeholder="which account or machine"
                className={inputCls}
                maxLength={60}
              />
            </label>
          </div>
          <label className="block">
            <span className={fieldLabelCls}>Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
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
          {saving ? 'Saving…' : 'Record order'}
        </button>
        <p className="mt-2 text-center text-xs text-stone-400">
          Cash off-book joins that day&apos;s drawer expectation automatically — the ladder already counts it.
        </p>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Recent off-book orders</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-rule-soft">
            {rows.map((r) => (
              <li key={r.id} className={`flex items-center justify-between gap-3 py-2.5 ${r.is_reversal ? 'opacity-60' : ''}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-stone-900">
                    {fmtDate(r.order_date)} · {r.payment_mode}
                    {r.description !== null && ` · ${r.description}`}
                    {r.is_reversal && ' · reversal'}
                    {r.is_voided && (
                      <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                        voided
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-stone-500">{r.entered_by !== null ? `by ${r.entered_by}` : ''}</span>
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
