'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPayment } from '@/server/books-actions'
import { requestVendorPayment } from '@/server/approvals-actions'
import type { BillOutstandingRow, MoneyAccount, PaymentResult, VendorAgingRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString, formatPaise, parseMoney } from '@/lib/money'
import { isCashMode } from '@/lib/payment-mode'
import Honesty from '@/components/Honesty'
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
  aging = null,
  bills = [],
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
  /** the vendor's row from vendor_aging, or null when nothing is outstanding */
  aging?: VendorAgingRow | null
  /** what the outstanding figure is MADE OF — a figure with no composition is
   *  a figure nobody can check */
  bills?: BillOutstandingRow[]
}) {
  const businessToday = useBusinessToday()
  const [paidDate, setPaidDate] = useState(businessToday)
  // NEVER BLANK. Settling the balance is the common case, and making him look
  // it up is how he pays the wrong number. A part payment is typed over it.
  const [amount, setAmount] = useState(() =>
    aging !== null && aging !== undefined && decimalStringToPaise(aging.outstanding) > 0 ? aging.outstanding : '',
  )
  const [mode, setMode] = useState(modes[0] ?? '')
  const [accountId, setAccountId] = useState('')
  const [note, setNote] = useState('')
  const [urgency, setUrgency] = useState<'normal' | 'overdue' | 'urgent'>('normal')
  const [advanceIntent, setAdvanceIntent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [done, setDone] = useState<Extract<PaymentResult, { ok: true }> | null>(null)
  const router = useRouter()

  // THE MODE DECIDES WHICH ACT THIS IS, and the screen says so before the
  // button is pressed rather than surprising him after.
  const cash = mode !== '' && isCashMode(mode)
  const owedPaise = aging ? decimalStringToPaise(aging.outstanding) : 0
  const amountPaise = parseMoney(amount.trim())
  const over = amountPaise !== null && owedPaise > 0 && amountPaise > owedPaise
  // An empty list means the payment cannot be classified, so it cannot be
  // recorded — said out loud rather than saved under a blank mode. The account
  // is held to the same bar: the server refuses a blank one by name.
  // CASH needs the account — a cash payment with no account leaves the drawer
  // unreconcilable. A TRANSFER must not carry one: the account is a fact about
  // a payment that does not exist yet, and it needs a reason instead, because
  // after a payment there is no negative twin to explain itself.
  const base = !busy && amountPaise !== null && amountPaise > 0 && mode !== ''
  const canSave = cash
    ? base && paidDate !== '' && accountId !== ''
    : base && note.trim() !== '' && (!over || advanceIntent)

  async function submit() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      if (cash) {
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
      } else {
        const res = await requestVendorPayment({
          vendorId,
          amount: amount.trim(),
          mode,
          urgency,
          reason: note.trim(),
          advanceIntent,
        })
        if (res.ok) {
          setSent(res.message)
          setAmount('')
          setNote('')
          setAdvanceIntent(false)
          router.refresh()
        } else {
          setError(res.error)
        }
      }
    } catch {
      setError(
        cash
          ? 'Could not reach the server — the payment was not recorded.'
          : 'Could not reach the server — the request was not sent.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={cardCls}>
      <h3 className={sectionHeadCls}>Pay {vendorName}</h3>
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
      {sent !== null && (
        <div className="mt-3">
          <SaveAck
            onDismiss={() => setSent(null)}
            headline={sent}
            sub="It is in the owner's approvals queue. Nothing has been paid and no account has been touched — whoever makes the transfer chooses that when they make it."
          />
        </div>
      )}

      {/* WHAT IS BEING SETTLED. A figure with no composition is a figure
          nobody can check, so the balance is stated as the bills it is made
          of — FIFO, oldest first, which is how the payment will actually
          land because payments here are ON ACCOUNT and tied to no bill. */}
      {aging !== null && decimalStringToPaise(aging.outstanding) > 0 && (
        <p className="mt-2 text-sm text-stone-600">
          <span className="font-semibold tabular-nums text-stone-900">
            {formatMoneyString(aging.outstanding)}
          </span>{' '}
          across {aging.open_bills} {aging.open_bills === 1 ? 'bill' : 'bills'}
          {aging.oldest_due !== null && <>, oldest due {fmtDate(aging.oldest_due)}</>}
          {aging.payment_terms !== null && <span className="text-stone-400"> · {aging.payment_terms}</span>}
        </p>
      )}
      {/* THE OLDEST FEW, because FIFO means these are the ones this payment
          actually clears. Not the whole list — the summary above is the
          figure, this is enough to recognise what it is made of. */}
      {bills.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {bills.slice(0, 3).map((b) => (
            <li key={b.purchase_id} className="flex justify-between gap-2 text-xs text-stone-500">
              <span className="truncate">
                {b.bill_no ?? 'no bill no'} · {fmtDate(b.bill_date)}
                {b.due_date !== null && <span className="text-stone-400"> · due {fmtDate(b.due_date)}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{formatMoneyString(b.unpaid)}</span>
            </li>
          ))}
          {bills.length > 3 && (
            <li className="text-xs text-stone-400">
              and {bills.length - 3} older {bills.length - 3 === 1 ? 'bill' : 'bills'}
            </li>
          )}
        </ul>
      )}
      {aging !== null && decimalStringToPaise(aging.terms_not_set) > 0 && (
        <div className="mt-2">
          <Honesty verdict="no payment terms" compact>
            {formatMoneyString(aging.terms_not_set)} of this sits on bills with no payment terms, so nothing can
            say when it fell due. A due date nobody agreed to would be worse than none — set the terms on the
            vendor.
          </Honesty>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        {cash && (
          <label className="block">
            <span className={fieldLabelCls}>Date</span>
            <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className={inputCls} />
          </label>
        )}
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
              No payment modes are set up — add them in Setup → Lists.
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
        {/* THE ACCOUNT IS ON THE CASH BRANCH ONLY. He watched the money leave
            the till or his own pocket, so he knows which — and a cash payment
            with no account leaves the drawer unreconcilable. On a transfer he
            knows neither, and naming one would be guessing at a balance he
            cannot see. */}
        {cash ? (
          <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} label="Paid from" />
        ) : (
          <label className="block">
            <span className={fieldLabelCls}>How urgent</span>
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as 'normal' | 'overdue' | 'urgent')}
              className={selectCls}
            >
              <option value="normal">Normal</option>
              <option value="overdue">Overdue</option>
              <option value="urgent">Urgent — supply at risk</option>
            </select>
          </label>
        )}
        <label className="block">
          <span className={fieldLabelCls}>{cash ? 'Note' : 'Reason'}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={cash ? 'optional' : 'why this should be paid'}
            className={inputCls}
            maxLength={300}
          />
        </label>
      </div>

      {/* AN ADVANCE IS LEGITIMATE AND A TYPO IS NOT, and the difference is
          whether somebody meant it — so it is asked as a plain question
          rather than inferred from the number. */}
      {over && !cash && (
        <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
          <input
            type="checkbox"
            checked={advanceIntent}
            onChange={(e) => setAdvanceIntent(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-xs text-amber-900">
            This is {formatPaise((amountPaise ?? 0) - owedPaise)} more than {vendorName} is owed — I mean it as an
            advance.
          </span>
        </label>
      )}

      {/* THE BRANCH, SAID IN THE WORDS OF THE ACT, before the button. */}
      {mode !== '' && (
        <p className="mt-3 text-xs text-stone-500">
          {cash ? (
            <>
              <span className="font-medium text-stone-700">You handed over the cash.</span> This records a payment
              now and moves the account you name.
            </>
          ) : (
            <>
              <span className="font-medium text-stone-700">You are not making this transfer.</span> This asks the
              owner to pay and record it — no money moves and no account is touched until they do.
            </>
          )}
        </p>
      )}
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
        {busy ? (cash ? 'Recording…' : 'Sending…') : cash ? 'Record payment' : 'Send to owner'}
      </button>
    </section>
  )
}
