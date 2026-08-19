'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPayment } from '@/server/books-actions'
import type { MoneyAccount, PaymentResult } from '@/lib/types'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
import SaveAck from '@/components/SaveAck'
import { cardCls, docNoCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'
import { useBusinessToday } from '@/components/BusinessDay'

export default function PaymentForm({
  vendorId,
  vendorName,
  modes,
  accounts,
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
  accounts: MoneyAccount[]
}) {
  const businessToday = useBusinessToday()
  const [paidDate, setPaidDate] = useState(businessToday)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState(modes[0] ?? '')
  const [accountId, setAccountId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Extract<PaymentResult, { ok: true }> | null>(null)
  const router = useRouter()

  const amountPaise = parseMoney(amount.trim())
  // An empty list means the payment cannot be classified, so it cannot be
  // recorded — said out loud rather than saved under a blank mode. The account
  // is held to the same bar: the server refuses a blank one by name.
  const canSave =
    !busy && paidDate !== '' && amountPaise !== null && amountPaise > 0 && mode !== '' && accountId !== ''

  async function submit() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await recordPayment({
        vendorId,
        paidDate,
        amount: amount.trim(),
        mode,
        accountId,
        note: note.trim(),
      })
      if (res.ok) {
        setDone(res)
        setAmount('')
        setAccountId('')
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
        <div className="mt-3">
          <SaveAck
            onDismiss={() => setDone(null)}
            headline={
              <>
                <span className="tabular-nums">{formatMoneyString(done.payment.amount)}</span> paid — {vendorName} is
                now owed <span className="tabular-nums">{formatMoneyString(done.dues.balance)}</span>
              </>
            }
            sub={
              <>
                {fmtDate(done.payment.paid_date)} · was {formatMoneyString(done.duesBefore)} · read live from
                vendor_dues
                {/* the moment to write on the paper: the number exists now
                    and never changes, including if this is later reversed */}
                {done.payment.doc_no !== null && (
                  <>
                    {' · '}
                    <span className={docNoCls}>{done.payment.doc_no}</span>
                  </>
                )}
              </>
            }
            missing={
              Number(done.dues.balance) > 0
                ? [
                    {
                      verdict: 'still owed',
                      text: `${vendorName} is owed ${formatMoneyString(done.dues.balance)} after this. The payment queue is ordered worst first, so they will keep their place on it until it reaches zero.`,
                    },
                  ]
                : undefined
            }
          />
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
        <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} label="Paid from" />
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
