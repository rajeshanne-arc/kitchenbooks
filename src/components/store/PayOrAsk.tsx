'use client'

// THE ONE PLACE A VENDOR PAYMENT IS DECIDED — mounted in the queue's inline
// expansion and on the vendor's own page, so there is one implementation of
// the branch rather than two that drift.
//
// HE IS NEVER ASKED TO CHOOSE BETWEEN "RECORD" AND "REQUEST". He picks a MODE,
// which is a fact he knows — he handed over notes, or he did not — and the
// screen says what follows BEFORE the button rather than surprising him after.
//
//   CASH            he watched the money leave. Straight to the ledger, and it
//                   names the account it left.
//   ANYTHING ELSE   he is not making this transfer. It becomes a request; no
//                   money moves and the balance does not change.
//
// THE MODE STARTS EMPTY. Preselecting the first one would decide the branch
// for him before he had said anything, which is the `issues.session` fault —
// a question that answers itself is not a question.
//
// THE ACKNOWLEDGEMENT IS THE CALLER'S. Paying a vendor in full removes them
// from `vendor_aging`, so the row this sits in disappears on the refresh and
// any state held here would go with it. `onDone` hands the numbers to
// something that survives — the queue above, or the vendor page.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPayment } from '@/server/books-actions'
import { requestVendorPayment } from '@/server/approvals-actions'
import type { BillOutstandingRow, MoneyAccount, VendorAgingRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString, formatPaise, parseMoney } from '@/lib/money'
import { isCashMode } from '@/lib/payment-mode'
import { modesForVendor } from '@/lib/payment-routing'
import Honesty from '@/components/Honesty'
import { fmtDate } from '@/lib/format'
import { useBusinessToday } from '@/components/BusinessDay'
import SaveAck from '@/components/SaveAck'
import { btnCls, docNoCls, fieldLabelCls, inputCls, selectCls } from '@/components/ui'

/** What happened, in figures the caller renders. Two shapes because the two
 *  acts leave the world in different states — and the second one's whole job
 *  is to say that nothing moved. */
export type PayAck =
  | {
      kind: 'paid'
      vendorName: string
      amount: string
      docNo: string | null
      owedAfter: string
      billsBefore: number
      account: { name: string; balance: string } | null
    }
  | { kind: 'asked'; vendorName: string; amount: string; mode: string; stillOwed: string }

export default function PayOrAsk({
  vendorId,
  vendorName,
  aging,
  bills,
  accounts,
  modes,
  onDone,
}: {
  vendorId: string
  vendorName: string
  /** null when nothing is outstanding — an advance, or a first payment */
  aging: VendorAgingRow | null
  bills: BillOutstandingRow[]
  accounts: MoneyAccount[]
  modes: string[]
  onDone: (ack: PayAck) => void
}) {
  const router = useRouter()
  const businessToday = useBusinessToday()
  const [paidDate, setPaidDate] = useState(businessToday)
  // NEVER BLANK. Settling the balance is the common case and making him look
  // it up is how he pays the wrong number; a part payment is typed over it.
  const [amount, setAmount] = useState(() =>
    aging !== null && decimalStringToPaise(aging.outstanding) > 0 ? aging.outstanding : '',
  )
  const [mode, setMode] = useState('')
  const [accountId, setAccountId] = useState('')
  const [note, setNote] = useState('')
  const [urgency, setUrgency] = useState<'normal' | 'overdue' | 'urgent'>('normal')
  const [advanceIntent, setAdvanceIntent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A MODE WHOSE DETAIL IS MISSING IS NOT OFFERED, and the screen says which
  // detail. Not one vendor here carries a UPI id, so UPI is withheld on every
  // row — an option that cannot be taken is worse than a missing one.
  const { allowed, withheld } = modesForVendor(modes, {
    upi_id: aging?.upi_id ?? null,
    account_no: aging?.account_no ?? null,
  })

  const cash = mode !== '' && isCashMode(mode)
  // CASH LEAVES A CASH ACCOUNT. This restaurant has none — four accounts, two
  // bank, a wallet and the owner's — so the branch says so rather than letting
  // him record the drawer against SBI and discover it at a reconciliation.
  const cashAccounts = accounts.filter((a) => a.kind === 'cash')
  const noCashAccount = cash && cashAccounts.length === 0

  const owedPaise = aging === null ? 0 : decimalStringToPaise(aging.outstanding)
  const amountPaise = parseMoney(amount.trim())
  const over = amountPaise !== null && owedPaise > 0 && amountPaise > owedPaise

  const base = !busy && amountPaise !== null && amountPaise > 0 && mode !== ''
  const canSave = cash
    ? base && !noCashAccount && paidDate !== '' && accountId !== ''
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
        if (!res.ok) {
          setError(res.error)
          return
        }
        onDone({
          kind: 'paid',
          vendorName,
          amount: res.payment.amount,
          docNo: res.payment.doc_no,
          owedAfter: res.dues.balance,
          billsBefore: aging?.open_bills ?? 0,
          account: res.account === null ? null : { name: res.account.name, balance: res.account.balance },
        })
      } else {
        const res = await requestVendorPayment({
          vendorId,
          amount: amount.trim(),
          mode,
          urgency,
          reason: note.trim(),
          advanceIntent,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        onDone({
          kind: 'asked',
          vendorName,
          amount: amount.trim(),
          mode,
          // UNCHANGED, AND THAT IS THE POINT. A request moves no money, so the
          // figure he was looking at is still the figure — echoed on purpose,
          // because the claim being made is that it did not move.
          stillOwed: aging?.outstanding ?? '0',
        })
      }
      setAmount('')
      setAccountId('')
      setNote('')
      setAdvanceIntent(false)
      router.refresh()
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
    <div>
      {/* WHAT IS BEING SETTLED, and what it is MADE OF. A figure with no
          composition is a figure nobody can check — and these are the bills
          this payment actually clears, because payments here are ON ACCOUNT
          and tied to no bill, so FIFO is what happens rather than a choice. */}
      {bills.length > 0 && (
        <ul className="space-y-0.5 border-b border-rule-soft pb-2">
          {bills.map((b) => (
            <li key={b.purchase_id} className="flex justify-between gap-2 text-xs text-stone-500">
              <span className="truncate">
                {b.bill_no ?? 'no bill no'} · {fmtDate(b.bill_date)}
                {b.due_date !== null && <span className="text-stone-400"> · due {fmtDate(b.due_date)}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{formatMoneyString(b.unpaid)}</span>
            </li>
          ))}
          {aging !== null && aging.open_bills > bills.length && (
            <li className="text-xs text-stone-400">
              and {aging.open_bills - bills.length} older{' '}
              {aging.open_bills - bills.length === 1 ? 'bill' : 'bills'}
            </li>
          )}
        </ul>
      )}

      {aging !== null && decimalStringToPaise(aging.terms_not_set) > 0 && (
        <div className="mt-2">
          <Honesty verdict="no payment terms" compact>
            {formatMoneyString(aging.terms_not_set)} of this sits on bills with no payment terms, so nothing
            can say when it fell due. Set the terms on the vendor — a due date nobody agreed to is worse than
            none.
          </Honesty>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
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
          <span className={fieldLabelCls}>How it goes</span>
          {allowed.length === 0 ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              No payment mode can be used for this vendor. Add them in Setup → Lists, or give the vendor bank
              details.
            </p>
          ) : (
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={selectCls}>
              <option value="">Choose how it goes</option>
              {allowed.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </label>

        {cash && !noCashAccount && (
          <>
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
              <span className={fieldLabelCls}>Paid from</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className={selectCls}
              >
                <option value="">Not chosen</option>
                {cashAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {!cash && mode !== '' && (
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

        {mode !== '' && (
          <label className="col-span-2 block">
            <span className={fieldLabelCls}>{cash ? 'Note' : 'Reason the owner will read'}</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={cash ? 'optional' : 'why this should be paid'}
              className={inputCls}
              maxLength={300}
            />
          </label>
        )}
      </div>

      {withheld.length > 0 && (
        <p className="mt-1.5 text-xs text-stone-500">
          Not offered: {withheld.map((w) => `${w.mode} (${w.why})`).join(' · ')}.
        </p>
      )}

      {/* §6, SAID BEFORE THE BUTTON RATHER THAN AT SAVE. A refusal at save is
          a refusal after the work, and this one is not his to fix. */}
      {noCashAccount && (
        <div className="mt-3">
          <Honesty verdict="nowhere for cash to come from" level="alarm">
            No cash account exists yet. Create one in Owner → Setup → Money accounts and count it — there are
            four accounts and not one of them is cash, so a cash payment has nowhere to leave from. Until
            then, any other mode still works and goes to the owner as a request.
          </Honesty>
        </div>
      )}

      {over && !cash && (
        <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
          <input
            type="checkbox"
            checked={advanceIntent}
            onChange={(e) => setAdvanceIntent(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-xs text-amber-900">
            This is {formatPaise((amountPaise ?? 0) - owedPaise)} more than {vendorName} is owed — I mean it
            as an advance.
          </span>
        </label>
      )}

      {/* THE BRANCH, IN THE WORDS OF THE ACT, BEFORE THE BUTTON. */}
      {mode !== '' && !noCashAccount && (
        <p className="mt-3 rounded-lg border border-rule bg-field px-3 py-2 text-xs text-stone-600">
          {cash ? (
            <>
              <span className="font-medium text-stone-800">You handed over the cash.</span> This records a
              payment now — it moves the account you name and clears what {vendorName} is owed.
            </>
          ) : (
            <>
              <span className="font-medium text-stone-800">You are not making this transfer.</span> This asks
              the owner to pay and record it. No money moves, no account is touched, and {vendorName} is owed
              exactly what they are owed now until somebody pays them.
            </>
          )}
        </p>
      )}

      {error !== null && (
        <div className="mt-3">
          <Honesty verdict="Nothing was written" level="alarm">
            {error}
          </Honesty>
        </div>
      )}

      <button type="button" onClick={submit} disabled={!canSave} className={`${btnCls} mt-3 w-full`}>
        {busy ? 'Working…' : mode === '' ? 'Choose how it goes' : cash ? 'Record payment' : 'Ask the owner'}
      </button>
    </div>
  )
}

/**
 * WHAT HAPPENED, IN NUMBERS RATHER THAN A CHECKMARK — and the two shapes say
 * genuinely different things.
 *
 * A PAYMENT is finished: the money left a named account, the vendor's balance
 * moved, and both figures are read back from the database rather than echoed.
 *
 * A REQUEST IS NOT, AND THE SECOND LINE IS THE WHOLE POINT. Without "no money
 * has moved; they still owe X" he reads the first line as "handled" and stops
 * chasing — which is how a vendor holds tomorrow's delivery over a payment
 * nobody made. It is the `missing` slot the honesty strip exists for: said
 * while it can still be acted on.
 */
export function PayAckView({ ack, onDismiss }: { ack: PayAck; onDismiss: () => void }) {
  if (ack.kind === 'asked') {
    return (
      <SaveAck
        onDismiss={onDismiss}
        headline={
          <>
            Asked the owner to pay {ack.vendorName}{' '}
            <span className="tabular-nums">{formatMoneyString(ack.amount)}</span>
          </>
        }
        sub={`by ${ack.mode} · it is in their approvals queue with the reason you gave`}
        missing={[
          {
            verdict: 'not paid',
            text: `No money has moved and no account has been touched. ${ack.vendorName} is still owed ${formatMoneyString(ack.stillOwed)} — they stay on this queue until somebody pays them.`,
          },
        ]}
      />
    )
  }

  const owed = decimalStringToPaise(ack.owedAfter)
  const negative = ack.account !== null && decimalStringToPaise(ack.account.balance) < 0
  return (
    <SaveAck
      onDismiss={onDismiss}
      headline={
        <>
          <span className="tabular-nums">{formatMoneyString(ack.amount)}</span> paid to {ack.vendorName}
          {ack.account !== null && <> from {ack.account.name}</>}.{' '}
          {owed <= 0 ? (
            <>
              They owe nothing
              {ack.billsBefore > 0 && (
                <> — {ack.billsBefore} {ack.billsBefore === 1 ? 'bill' : 'bills'} cleared</>
              )}
              .
            </>
          ) : (
            <>
              They are now owed <span className="tabular-nums">{formatMoneyString(ack.owedAfter)}</span>.
            </>
          )}
        </>
      }
      sub={
        <>
          read back from vendor_dues
          {ack.account !== null && (
            <>
              {' · '}
              {ack.account.name} now holds{' '}
              <span className={negative ? 'font-semibold text-red-700' : ''}>
                {formatMoneyString(ack.account.balance)}
              </span>
            </>
          )}
          {ack.docNo !== null && (
            <>
              {' · '}
              <span className={docNoCls}>{ack.docNo}</span>
            </>
          )}
        </>
      }
      missing={[
        // A NEGATIVE ACCOUNT IS LOUD. It means more has been paid out of it
        // than ever went in on the books — a missing deposit, or a payment
        // recorded against the wrong account, and either is a thing to find
        // now rather than at a reconciliation.
        ...(negative && ack.account !== null
          ? [
              {
                verdict: 'account is overdrawn on the books',
                text: `${ack.account.name} now reads ${formatMoneyString(ack.account.balance)}. More has gone out of it than the books say went in — either a deposit has not been entered, or a payment is against the wrong account.`,
              },
            ]
          : []),
        ...(owed > 0
          ? [
              {
                verdict: 'still owed',
                text: `${ack.vendorName} is owed ${formatMoneyString(ack.owedAfter)} after this, so they keep their place on the queue until it reaches zero.`,
              },
            ]
          : []),
      ]}
    />
  )
}

/**
 * THE WHOLE THING WHERE THE ROW DOES NOT VANISH.
 *
 * On a vendor's own page the form is not inside a list that reorders itself,
 * so the acknowledgement renders exactly where the button was and nothing has
 * to be lifted. The queue cannot use this: paying a vendor in full removes
 * them from `vendor_aging`, and an acknowledgement held inside the row would
 * unmount with it — so there it is held above the list instead.
 *
 * Two placements, one reason, and the reason is about the parent rather than
 * about the form.
 */
export function PayPanel(props: Omit<Parameters<typeof PayOrAsk>[0], 'onDone'>) {
  const [ack, setAck] = useState<PayAck | null>(null)
  return (
    <div>
      {ack !== null && (
        <div className="mb-3">
          <PayAckView ack={ack} onDismiss={() => setAck(null)} />
        </div>
      )}
      <PayOrAsk {...props} onDone={setAck} />
    </div>
  )
}
