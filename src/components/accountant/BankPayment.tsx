'use client'

// The accountant pays a vendor by transfer, from home.
//
// PRINCIPLE 1 OF THIS PHASE: whoever touches the money records it. The store
// manager handing cash to a vegetable vendor at the door records that
// payment — routing it through the accountant would only mean it went
// unrecorded. The accountant making a bank transfer at eleven at night
// records THAT one, here, for exactly the same reason.
//
// Same action as the store's own payment form: one recordPayment, one
// payments table, one PAY series. The two screens exist because two people
// are in two places, not because there are two kinds of payment.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MoneyAccount, PaymentResult, VendorDueRow } from '@/lib/types'
import { recordPayment } from '@/server/books-actions'
import { decimalStringToPaise, formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
import SaveAck from '@/components/SaveAck'
import {
  btnCls,
  cardCls,
  docNoCls,
  fieldLabelCls,
  inputCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'
import { toast } from '@/components/Toasts'
import { useBusinessToday } from '@/components/BusinessDay'

export default function BankPayment({
  vendors,
  accounts,
  modes,
}: {
  vendors: VendorDueRow[]
  accounts: MoneyAccount[]
  modes: string[]
}) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const [vendorId, setVendorId] = useState('')
  const [paidDate, setPaidDate] = useState(businessToday)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('')
  const [accountId, setAccountId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Extract<PaymentResult, { ok: true }> | null>(null)

  const chosen = vendors.find((v) => v.id === vendorId) ?? null
  // WHAT THE TYPED AMOUNT WOULD LEAVE BEHIND. Null unless it genuinely goes
  // past the debt, so the note is silent on every ordinary payment — a strip
  // that is always there is one people learn to look past.
  const typedPaise = parseMoney(amount.trim())
  const owedPaise = chosen === null ? null : decimalStringToPaise(chosen.balance)
  const willCredit =
    chosen !== null && typedPaise !== null && owedPaise !== null && typedPaise > owedPaise
      ? {
          name: chosen.name,
          owed: chosen.balance,
          credit: ((typedPaise - owedPaise) / 100).toFixed(2),
        }
      : null
  const canSave =
    !busy &&
    vendorId !== '' &&
    accountId !== '' &&
    paidDate !== '' &&
    (parseMoney(amount.trim()) ?? 0) > 0

  async function save() {
    if (!canSave) return
    setBusy(true)
    try {
      const res = await recordPayment({
        vendorId,
        accountId,
        paidDate,
        amount: amount.trim(),
        mode,
        note: note.trim(),
      })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      setDone(res)
      setAmount('')
      setNote('')
      setAccountId('')
      router.refresh()
    } catch {
      toast('Could not reach the server — the payment was not recorded.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (vendors.length === 0) {
    return (
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Pay a vendor</h2>
        <p className="mt-1.5 text-sm text-stone-700">
          Nobody is owed anything. Vendors appear here once a bill has been entered against them.
        </p>
      </section>
    )
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Pay a vendor</h2>
      <p className="mt-1 text-xs text-stone-500">
        The transfer you make from home. The store records what it hands over at the door — one
        payments table either way.
      </p>

      {done !== null && (
        <div className="mt-3">
          <SaveAck
            onDismiss={() => setDone(null)}
            headline={
              <>
                {/* A NEGATIVE BALANCE IS CREDIT, NOT A NEGATIVE DEBT. This
                    read "they are now owed −₹500" when a payment went past
                    what was owed — the same fault this file records for an
                    over-recovered advance reading as "already owes −₹500".
                    Paying past the debt is exactly what an ADVANCE is, and
                    this is the screen advances are made from, so the case is
                    the normal one here rather than an edge. */}
                <span className="tabular-nums">{formatMoneyString(done.payment.amount)}</span> paid —{' '}
                {Number(done.dues.balance) < 0 ? (
                  <>
                    they are now <strong>in credit</strong>{' '}
                    <span className="tabular-nums">
                      {formatMoneyString(String(Math.abs(Number(done.dues.balance))))}
                    </span>
                  </>
                ) : Number(done.dues.balance) === 0 ? (
                  <>their account is clear</>
                ) : (
                  <>
                    they are now owed{' '}
                    <span className="tabular-nums">{formatMoneyString(done.dues.balance)}</span>
                  </>
                )}
              </>
            }
            sub={
              <>
                {fmtDate(done.payment.paid_date)} · was {formatMoneyString(done.duesBefore)} · read live from
                vendor_dues · the SAME payments table and PAY series as the store&apos;s form — one kind of payment,
                two people in two places
                {done.payment.doc_no !== null && (
                  <>
                    {' · '}
                    <span className={docNoCls}>{done.payment.doc_no}</span>
                  </>
                )}
              </>
            }
          />
        </div>
      )}

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className={fieldLabelCls}>Vendor</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={selectCls}>
            <option value="">—</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} — {formatMoneyString(v.balance)} owed
              </option>
            ))}
          </select>
          {chosen !== null && chosen.payment_terms !== null && (
            <span className="mt-1 block text-xs text-stone-500">terms: {chosen.payment_terms}</span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Date</span>
            <input
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Amount</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className={inputCls}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={selectCls}>
              <option value="">—</option>
              {modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <AccountPicker
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
            label="Paid from"
          />
        </div>

        <label className="block">
          <span className={fieldLabelCls}>Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="reference, invoice numbers settled"
            className={inputCls}
          />
        </label>

        {/* SAID BEFORE THE BUTTON, because this is the advance path and
            paying past the debt is the point of it rather than a slip. It is
            a note, never a refusal: the store's request flow refuses an amount
            above the bills in range and names this screen, so refusing here
            too would leave advances with nowhere to go at all. */}
        {willCredit !== null && (
          <p className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
            That is more than {willCredit.name} is owed ({formatMoneyString(willCredit.owed)}). It will go
            through and leave them in credit {formatMoneyString(willCredit.credit)} — which is what an
            advance looks like on the books.
          </p>
        )}
        <button type="button" disabled={!canSave} onClick={() => void save()} className={btnCls}>
          {busy ? 'Recording…' : 'Record payment'}
        </button>
      </div>
    </section>
  )
}
