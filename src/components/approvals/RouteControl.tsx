'use client'

// PAY FROM WHERE, AND BY WHOM — the owner's half of a payment request.
//
// Approving one changes nothing about money: it says yes. This is the act that
// turns a decision into a payment, and it is deliberately TWO acts rather than
// one, because they are two different things happening to the same request:
//
//   PAY AND RECORD   the owner makes the transfer himself. One transaction
//                    writes the payments row, the `paid` event and the status,
//                    and the request is finished.
//   SEND TO THE      the owner says HOW it should go and hands it over. The
//   ACCOUNTANT       approval stands, the route is set, and it lands in their
//                    queue — which is the only thing in the app that sets
//                    assigned_to to another role, and therefore the only thing
//                    that can make their badge fire.
//
// THE ACKNOWLEDGEMENT IS THE PARENT'S, and that is forced rather than chosen.
// Both acts REMOVE this request from the owner's queue — paid is finished,
// forwarded is somebody else's — so the card this control sits in is gone on
// the next render and any state in it goes with the card. `onDone` hands the
// sentence to the queue above, which survives because a paid request lands in
// "Already decided" and a forwarded one in "Out with somebody else".
//
// THE SUGGESTED MODE IS READ AS A SUGGESTION, NEVER AS SOMETHING BEING
// OVERRIDDEN. The store manager knows the vendor wants paying; the owner knows
// which account is liquid. `suggested_mode` and `routed_mode` differing is a
// fact worth keeping, not a discrepancy to reconcile away — so the screen
// prefills the suggestion, labels it as one, and says nothing when it changes.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Honesty from '@/components/Honesty'
import CopyField from '@/components/books/CopyField'
import { payApproval, routePayment } from '@/server/approvals-actions'
import type { AwaitingRow, VendorRouting } from '@/server/approvals-queries'
import { modesForVendor } from '@/lib/payment-routing'
import type { AccountBalanceRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { btnCls, btnGhostCls, fieldLabelCls, inputCls, selectCls } from '@/components/ui'

export default function RouteControl({
  row,
  vendor,
  balances,
  modes,
  today,
  onDone,
}: {
  row: AwaitingRow
  vendor: VendorRouting | undefined
  balances: AccountBalanceRow[]
  modes: string[]
  today: string
  onDone: (m: string) => void
}) {
  const router = useRouter()
  const { allowed, withheld } = modesForVendor(modes, vendor)
  const suggested = row.suggested_mode ?? null
  const [mode, setMode] = useState(
    row.routed_mode !== null && allowed.includes(row.routed_mode)
      ? row.routed_mode
      : suggested !== null && allowed.includes(suggested)
        ? suggested
        : '',
  )
  // NO DEFAULT ACCOUNT, AND THERE NEVER WILL BE. Three columns of this app's
  // history are a column default standing in for a human answer; the account
  // money leaves is the one nobody may guess.
  const [accountId, setAccountId] = useState(row.routed_account_id ?? '')
  const [paidDate, setPaidDate] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<null | 'pay' | 'forward'>(null)
  const [error, setError] = useState<string | null>(null)

  const askPaise = row.amount === null ? 0 : decimalStringToPaise(row.amount)
  const chosen = balances.find((b) => b.account_id === accountId)
  const short =
    chosen !== undefined && askPaise > 0 && decimalStringToPaise(chosen.balance) < askPaise

  async function run(which: 'pay' | 'forward') {
    setBusy(which)
    setError(null)
    const r =
      which === 'pay'
        ? await payApproval({ id: row.id, accountId, paidDate, mode, note: note.trim() })
        : await routePayment({
            id: row.id,
            mode,
            accountId,
            assignTo: 'accountant',
            note: note.trim(),
          })
    setBusy(null)
    if (!r.ok) setError(r.error)
    else onDone(r.message)
    router.refresh()
  }

  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">How it will be paid</h4>

      {/* A MISSING KEY IS NOT A VENDOR WITHOUT DETAILS. `vendors` is keyed by
          the entity_id of these very rows, so an absent one means the lookup
          failed — a discarded vendor, a cross-tenant id, a query that did not
          return what it was asked for — and rendering the no-bank-details
          state would report that as a fact about the vendor. */}
      {vendor === undefined && (
        <div className="mt-2">
          <Honesty verdict="vendor could not be read" level="alarm">
            Nothing came back for the vendor on this request, so where the money
            would go and what is owed today are both unknown — that is a failed
            lookup, not a vendor with no bank details. Do not pay it from here
            until the vendor opens on their own page.
          </Honesty>
        </div>
      )}

      {/* WHERE THE MONEY WOULD ACTUALLY GO. Read now, never from the snapshot:
          an account number frozen into a jsonb blob in June is what somebody
          would transfer money to in September. */}
      {vendor !== undefined && (
        <div className="mt-2">
          {(vendor.account_no ?? '') === '' && (vendor.upi_id ?? '') === '' ? (
            <Honesty verdict="nowhere to send it" level="alarm">
              {vendor.name} has no account number and no UPI id on record, so nothing here can be
              transferred to them. Cash or a cheque still works; a transfer needs the details on the
              vendor, and until they are there this is a payment somebody has to chase by phone.
            </Honesty>
          ) : (
            <div className="rounded-lg border border-rule bg-field/40 px-3 py-1">
              {vendor.bank_name !== null && vendor.bank_name !== '' && (
                <CopyField label="Bank" value={vendor.bank_name} />
              )}
              {vendor.account_no !== null && vendor.account_no !== '' && (
                <CopyField label="Account number" value={vendor.account_no} group />
              )}
              {vendor.ifsc !== null && vendor.ifsc !== '' && <CopyField label="IFSC" value={vendor.ifsc} />}
              {vendor.upi_id !== null && vendor.upi_id !== '' && (
                <CopyField label="UPI" value={vendor.upi_id} />
              )}
            </div>
          )}

          {/* THE AGEING AS IT STANDS, beside the figure taken at asking. Two
              readings of one number, and the screen refuses to collapse them:
              a bill landing or a payment clearing in between is exactly what
              the owner needs to see before he sends money. */}
          <p className="mt-2 text-xs text-stone-500">
            {vendor.outstanding === null ? (
              <span className="text-amber-800">
                Nothing is outstanding to {vendor.name} today — it was settled after this was asked.
              </span>
            ) : (
              <>
                Owed now: {formatMoneyString(vendor.outstanding)}
                {vendor.open_bills !== null && <> across {vendor.open_bills} bills</>}
                {vendor.oldest_due !== null && <>, oldest due {fmtDate(vendor.oldest_due)}</>}.
              </>
            )}
          </p>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabelCls}>Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={selectCls}>
            <option value="">Choose how it goes</option>
            {allowed.map((m) => (
              <option key={m} value={m}>
                {m}
                {m === suggested ? ' — suggested' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabelCls}>From which account</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectCls}>
            <option value="">Not chosen</option>
            {balances.map((b) => (
              <option key={b.account_id} value={b.account_id}>
                {b.name} — {formatMoneyString(b.balance)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* AN OPTION THAT CANNOT BE TAKEN IS WORSE THAN A MISSING ONE, because
          somebody picks it and finds out afterwards. Zero of this restaurant's
          39 vendors carry a UPI id, so UPI is offered on no vendor at all —
          said here rather than shown as a choice that fails. */}
      {withheld.length > 0 && (
        <p className="mt-1.5 text-xs text-stone-500">
          Not offered: {withheld.map((w) => `${w.mode} (${w.why})`).join(' · ')}.
        </p>
      )}

      {suggested !== null && mode !== '' && mode !== suggested && (
        <p className="mt-1.5 text-xs text-stone-500">
          {row.requested_by ?? 'They'} suggested {suggested}. You know which account is liquid and they do
          not — both are kept on the record, and neither is a correction of the other.
        </p>
      )}

      {short && chosen !== undefined && (
        <div className="mt-2">
          <Honesty verdict="not enough in it">
            {chosen.name} holds {formatMoneyString(chosen.balance)} and this is{' '}
            {formatMoneyString(row.amount ?? '0')}. Recording it against that account would leave it
            overdrawn on the books — move money first, or pay from somewhere else.
          </Honesty>
        </div>
      )}

      <label className="mt-3 block">
        <span className={fieldLabelCls}>Date paid</span>
        <input
          type="date"
          value={paidDate}
          onChange={(e) => setPaidDate(e.target.value)}
          className={inputCls}
        />
      </label>

      <label className="mt-3 block">
        <span className={fieldLabelCls}>Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} maxLength={300} />
      </label>

      {error !== null && (
        <div className="mt-3">
          <Honesty verdict="Nothing was written" level="alarm">
            {error}
          </Honesty>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run('pay')}
          disabled={busy !== null || mode === '' || accountId === '' || paidDate === ''}
          className={btnCls}
        >
          {busy === 'pay' ? 'Recording…' : 'I paid it — record it'}
        </button>
        <button
          type="button"
          onClick={() => run('forward')}
          disabled={busy !== null || mode === ''}
          className={btnGhostCls}
        >
          {busy === 'forward' ? 'Sending…' : 'Send to the accountant'}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-stone-500">
        Recording it writes the payment, the event and the vendor&rsquo;s balance in one go. Sending it
        keeps the approval and hands over the route — it stays approved, and it stops being yours.
      </p>
    </div>
  )
}
