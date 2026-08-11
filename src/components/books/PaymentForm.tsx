'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPayment } from '@/server/books-actions'
import type { PaymentResult } from '@/lib/types'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'

export default function PaymentForm({
  vendorId,
  vendorName,
  modes,
}: {
  vendorId: string
  vendorName: string
  /** payment_mode list values (LAW 2). REQUIRED — there is deliberately no
   *  hardcoded fallback. The old default was `modes = MODES`, which a JS
   *  default only applies for `undefined`: a caller passing the genuinely
   *  empty list got an empty <select> and no fallback, while a caller that
   *  omitted the prop got a hardcoded 'Other' that the list does not
   *  contain. Two call sites, two different sets of modes, neither of them
   *  the list. LAW 2 means the list or nothing. */
  modes: string[]
}) {
  const [paidDate, setPaidDate] = useState(todayLocal)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState(modes[0] ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Extract<PaymentResult, { ok: true }> | null>(null)
  const router = useRouter()

  const amountPaise = parseMoney(amount.trim())
  // An empty list means the payment cannot be classified, so it cannot be
  // recorded — said out loud rather than saved under a blank mode.
  const canSave = !busy && paidDate !== '' && amountPaise !== null && amountPaise > 0 && mode !== ''

  async function submit() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await recordPayment({ vendorId, paidDate, amount: amount.trim(), mode, note: note.trim() })
      if (res.ok) {
        setDone(res)
        setAmount('')
        setNote('')
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the payment was not recorded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={cardCls}>
      <h3 className={sectionHeadCls}>Record payment</h3>
      {done && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-stone-800">
          Recorded <span className="font-semibold tabular-nums">{formatMoneyString(done.payment.amount)}</span> on{' '}
          {fmtDate(done.payment.paid_date)} — {vendorName}’s dues:{' '}
          <span className="tabular-nums">{formatMoneyString(done.duesBefore)}</span>
          {' → '}
          <span className="font-bold tabular-nums">{formatMoneyString(done.dues.balance)}</span>
          <span className="ml-1 text-xs text-stone-500">· read live from vendor_dues</span>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelCls}>Date</span>
          <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Amount</span>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-stone-400">
              ₹
            </span>
            <input
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${inputCls} pl-7`}
            />
          </div>
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Mode</span>
          {modes.length === 0 ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              No payment modes are set up — add them in Settings → Lists.
            </p>
          ) : (
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={selectCls}>
              {modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional"
            className={inputCls}
            maxLength={300}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={!canSave}
        className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {busy ? 'Recording…' : 'Record payment'}
      </button>
    </section>
  )
}
