'use client'

// THE OTHER END OF THE ROUTE — three acts, and the two send-backs are
// deliberately different sentences rather than one "reject".
//
//   PAY AND RECORD   the transfer is made. One transaction writes the
//                    payments row, the `paid` event and the status.
//   RETURN           "I CANNOT PAY IT THIS WAY." The account is short, the
//                    beneficiary is not registered, the bank is down. None of
//                    that is an objection to paying the vendor, so the
//                    approval STANDS and only the route comes off. It goes
//                    back to the owner to be routed again, never re-decided.
//   CHALLENGE        "I DO NOT THINK THIS SHOULD BE PAID." The vendor was
//                    already paid, the amount is wrong, the bill is disputed.
//                    That is an objection to the PAYMENT, so it goes back for
//                    a decision and the owner answers it again.
//
// Collapsing the two would lose the only thing that distinguishes them, which
// is what the owner has to do next. A reason is REQUIRED on both: after a send
// back there is nothing else anywhere that explains why the route changed.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Honesty from '@/components/Honesty'
import { toast } from '@/components/Toasts'
import CopyField from '@/components/books/CopyField'
import { challengeRequest, payApproval, returnRequest } from '@/server/approvals-actions'
import type { AwaitingRow, VendorRouting } from '@/server/approvals-queries'
import type { AccountBalanceRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import {
  btnCls,
  btnGhostCls,
  cardCls,
  fieldLabelCls,
  inputCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'

export default function AwaitingActions({
  rows,
  vendors,
  balances,
  today,
  mine,
  role,
}: {
  rows: AwaitingRow[]
  vendors: Record<string, VendorRouting>
  balances: AccountBalanceRow[]
  today: string
  /** the reader IS the role this was routed to */
  mine: boolean
  role: string
}) {
  // THE ACKNOWLEDGEMENT CANNOT LIVE IN HERE, and finding out why is the point.
  // Paying the last routed request empties this panel, so the server renders
  // nothing where it was, React unmounts the subtree and any state in it goes
  // with the row — the acknowledgement would flash and vanish. The ROW LEAVING
  // is the change on screen; the bottom-anchored toast carries the numbers,
  // which is the same answer the three inline row controls already give.
  return (
    <section className={`${cardCls} mb-4 border-amber-300`}>
      <h2 className={sectionHeadCls}>{mine ? 'Routed to you' : `Routed to the ${role}`}</h2>
      <ul className="mt-2 divide-y divide-rule-soft">
        {rows.map((r) => (
          <Row key={r.id} row={r} vendor={vendors[r.entity_id]} balances={balances} today={today} />
        ))}
      </ul>
    </section>
  )
}

function Row({
  row,
  vendor,
  balances,
  today,
}: {
  row: AwaitingRow
  vendor: VendorRouting | undefined
  balances: AccountBalanceRow[]
  today: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  // THE MODE COMES FROM THE ROUTE, not from a list. The owner chose it; this
  // screen is not where it is re-argued. It stays editable because the person
  // at the bank is the one who finds out it cannot go that way — and if it
  // cannot, the honest act is a RETURN, which is the button beside it.
  const [mode, setMode] = useState(row.routed_mode ?? row.suggested_mode ?? '')
  const [accountId, setAccountId] = useState(row.routed_account_id ?? '')
  const [paidDate, setPaidDate] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<null | 'pay' | 'return' | 'challenge'>(null)
  const [error, setError] = useState<string | null>(null)

  const askPaise = row.amount === null ? 0 : decimalStringToPaise(row.amount)
  const chosen = balances.find((b) => b.account_id === accountId)
  const short = chosen !== undefined && askPaise > 0 && decimalStringToPaise(chosen.balance) < askPaise

  async function run(which: 'pay' | 'return' | 'challenge') {
    setBusy(which)
    setError(null)
    const r =
      which === 'pay'
        ? await payApproval({ id: row.id, accountId, paidDate, mode, note: note.trim() })
        : which === 'return'
          ? await returnRequest({ id: row.id, reason: note.trim() })
          : await challengeRequest({ id: row.id, reason: note.trim() })
    setBusy(null)
    if (!r.ok) setError(r.error)
    else toast(r.message, 'ok')
    router.refresh()
  }

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-stone-900">{row.from_name ?? 'a vendor'}</span>
        {row.amount !== null && (
          <span className="font-mono font-semibold text-stone-900">{formatMoneyString(row.amount)}</span>
        )}
        {row.routed_mode !== null && <span className="text-sm text-stone-600">by {row.routed_mode}</span>}
        <span className="ml-auto text-xs text-stone-400">
          {row.requested_by ?? 'someone'} · {fmtDateTime(row.requested_at)}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-stone-600">“{row.reason}”</p>
      {row.last_note !== null && row.last_action !== 'raised' && (
        <p className="mt-0.5 text-[13px] text-stone-500">
          {row.last_by ?? 'the owner'}: “{row.last_note}”
        </p>
      )}
      {/* A MISSING KEY IS NOT A VENDOR WITHOUT DETAILS — see RouteControl. The
          map is keyed by these rows' own entity_ids, so an absent one is a
          failed lookup and must not render as an absence of bank details. */}
      {vendor === undefined && (
        <p className="mt-1 text-[13px] text-red-800">
          Nothing came back for this vendor — where the money would go and what is owed are both unknown.
          That is a failed lookup, not a vendor with no details.
        </p>
      )}
      {vendor !== undefined && vendor.outstanding !== null && (
        <p className="mt-0.5 text-xs text-stone-500">
          Owed now: {formatMoneyString(vendor.outstanding)}
          {vendor.open_bills !== null && <> across {vendor.open_bills} bills</>}
          {vendor.oldest_due !== null && <>, oldest due {fmtDate(vendor.oldest_due)}</>}.
        </p>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 min-h-[40px] rounded-lg border border-rule px-3 py-2 text-xs font-medium text-stone-700 hover:border-stone-400"
        >
          Pay it, or send it back →
        </button>
      ) : (
        <div className="mt-2 rounded-xl border border-rule bg-white p-3">
          {/* THE DETAILS THE TRANSFER IS ACTUALLY TYPED FROM. This is the
              screen where an account number is retyped into a bank app under
              time pressure, so the machine does the copying. */}
          {vendor !== undefined &&
            ((vendor.account_no ?? '') !== '' || (vendor.upi_id ?? '') !== '') && (
              <div className="rounded-lg border border-rule bg-field/40 px-3 py-1">
                {vendor.bank_name !== null && vendor.bank_name !== '' && (
                  <CopyField label="Bank" value={vendor.bank_name} />
                )}
                {vendor.account_no !== null && vendor.account_no !== '' && (
                  <CopyField label="Account number" value={vendor.account_no} group />
                )}
                {vendor.ifsc !== null && vendor.ifsc !== '' && (
                  <CopyField label="IFSC" value={vendor.ifsc} />
                )}
                {vendor.upi_id !== null && vendor.upi_id !== '' && (
                  <CopyField label="UPI" value={vendor.upi_id} />
                )}
              </div>
            )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={fieldLabelCls}>Mode</span>
              <input value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls} maxLength={40} />
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

          {short && chosen !== undefined && (
            <div className="mt-2">
              <Honesty verdict="not enough in it">
                {chosen.name} holds {formatMoneyString(chosen.balance)} and this is{' '}
                {formatMoneyString(row.amount ?? '0')}. If it cannot go from there, send it back rather than
                recording a payment the account cannot carry.
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
            <span className={fieldLabelCls}>
              Note — required to send it back, either way
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputCls}
              maxLength={300}
            />
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
            {/* SENDING IT BACK TO YOURSELF IS NOT AN ACT. An owner standing
                here is looking at their own queue; the server refuses both by
                name, and offering a button whose only outcome is a refusal is
                the picker-is-not-the-check rule pointed the wrong way. */}
            {row.assigned_to !== 'owner' && (
              <>
            <button
              type="button"
              onClick={() => run('return')}
              disabled={busy !== null || note.trim() === ''}
              className={btnGhostCls}
            >
              {busy === 'return' ? 'Sending…' : 'I cannot pay it this way'}
            </button>
            <button
              type="button"
              onClick={() => run('challenge')}
              disabled={busy !== null || note.trim() === ''}
              className={btnGhostCls}
            >
              {busy === 'challenge' ? 'Sending…' : 'I do not think this should be paid'}
            </button>
              </>
            )}
          </div>

          {/* THE DIFFERENCE BETWEEN THE TWO, in the words of what happens next
              rather than in the words of a status. */}
          <p className="mt-1.5 text-xs text-stone-500">
            Sending it back the first way keeps the approval and asks the owner to say how else it can go.
            The second withdraws the question entirely — the owner decides again whether to pay at all.
          </p>
        </div>
      )}
    </li>
  )
}
