'use client'

// THE OTHER END OF THE ROUTE — and what the accountant is actually reviewing.
//
// HE CANNOT CHECK WHETHER THE GOODS ARRIVED. The store manager stood at the
// door and received them; that is settled and not his to re-open. What he CAN
// check is arithmetic, duplicates, anomalies in a vendor's numbering, and
// whether our figure agrees with the vendor's own statement.
//
// SO THE COMPOSITION IS A DISCLOSURE, NOT AN APPROVAL STEP. It is a
// RECONCILIATION check rather than a receipt check — which is why there are NO
// PER-BILL CHECKBOXES. Ticking bills would turn a reconciliation glance into a
// second approval, and the owner has already approved: the accountant is
// executing a decision, not re-taking it.
//
// TWO ACTIONS, AND THE SECOND IS NOT "REFUSE". He cannot refuse the payment —
// the owner decided it should be made. He is declining to EXECUTE, and handing
// the decision back with what he found.
//
//   I PAID IT — RECORD IT
//   SEND IT BACK              a note is required, and refused by name if blank
//
// `challenged` IS COLLAPSED INTO `returned`. Three buttons made him classify
// WHY before he could act, and the paragraph explaining routing-problem versus
// should-we-pay-problem is a paragraph nobody reads at four in the afternoon.
// HE STATES THE FACT; THE OWNER CLASSIFIES IT — and the owner is the one with
// the information to tell them apart. "Their account is closed" and "I do not
// think we owe this" both come back with a reason, and he decides what each
// means.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Honesty from '@/components/Honesty'
import { toast } from '@/components/Toasts'
import CopyField from '@/components/books/CopyField'
import BillNumberGap from '@/components/books/BillNumberGap'
import { payApproval, returnRequest } from '@/server/approvals-actions'
import type { AwaitingRow, VendorRouting } from '@/server/approvals-queries'
import type { AccountBalanceRow, BillOutstandingRow } from '@/lib/types'
import type { BillNumbers } from '@/lib/bill-gaps'
import { applyFifo } from '@/lib/settle'
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
  bills,
  numbers,
  balances,
  today,
  mine,
  role,
}: {
  rows: AwaitingRow[]
  vendors: Record<string, VendorRouting>
  bills: Record<string, BillOutstandingRow[]>
  numbers: Record<string, BillNumbers>
  balances: AccountBalanceRow[]
  today: string
  mine: boolean
  role: string
}) {
  // THE ROW IS THE CONTROL. "Pay it, or send it back →" was one button
  // carrying two verbs, and it made the row itself un-openable — the same
  // fault as an action clipped into the last column, arrived at from the other
  // direction.
  const [open, setOpen] = useState<string | null>(null)

  return (
    <section className={`${cardCls} mb-4 border-amber-300`}>
      <h2 className={sectionHeadCls}>{mine ? 'Routed to you' : `Routed to the ${role}`}</h2>
      <ul className="mt-2 divide-y divide-rule-soft">
        {rows.map((r) => (
          <Row
            key={r.id}
            row={r}
            vendor={vendors[r.entity_id]}
            bills={bills[r.entity_id] ?? []}
            numbers={numbers[r.entity_id]}
            balances={balances}
            today={today}
            isOpen={open === r.id}
            // LIFTED THREE WAYS AT ONCE, because any one alone is missable on a
            // long queue: the open row is tinted, carries a bar down its left
            // edge, and the others are dimmed. Together it is unmistakable
            // which one is open.
            dimmed={open !== null && open !== r.id}
            onToggle={() => setOpen(open === r.id ? null : r.id)}
          />
        ))}
      </ul>
    </section>
  )
}

function Row({
  row,
  vendor,
  bills,
  numbers,
  balances,
  today,
  isOpen,
  dimmed,
  onToggle,
}: {
  row: AwaitingRow
  vendor: VendorRouting | undefined
  bills: BillOutstandingRow[]
  numbers: BillNumbers | undefined
  balances: AccountBalanceRow[]
  today: string
  isOpen: boolean
  dimmed: boolean
  onToggle: () => void
}) {
  const router = useRouter()
  const [mode, setMode] = useState(row.routed_mode ?? row.suggested_mode ?? '')
  const [accountId, setAccountId] = useState(row.routed_account_id ?? '')
  const [paidDate, setPaidDate] = useState(today)
  const [note, setNote] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState<null | 'pay' | 'back'>(null)
  const [error, setError] = useState<string | null>(null)

  const askPaise = row.amount === null ? 0 : decimalStringToPaise(row.amount)
  const chosen = balances.find((b) => b.account_id === accountId)
  const short = chosen !== undefined && askPaise > 0 && decimalStringToPaise(chosen.balance) < askPaise

  async function run(which: 'pay' | 'back') {
    setBusy(which)
    setError(null)
    const r =
      which === 'pay'
        ? await payApproval({ id: row.id, accountId, paidDate, mode, note: note.trim() })
        : await returnRequest({ id: row.id, reason: note.trim() })
    setBusy(null)
    if (!r.ok) setError(r.error)
    else toast(r.message, 'ok')
    router.refresh()
  }

  return (
    <li
      onClick={onToggle}
      className={`relative cursor-pointer py-2.5 pl-3 transition-opacity ${
        isOpen ? 'bg-amber-50/70' : dimmed ? 'opacity-45 hover:opacity-80' : 'hover:bg-stone-50'
      }`}
    >
      {isOpen && <span className="absolute inset-y-0 left-0 w-1 rounded-full bg-amber-500" />}

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

      {vendor === undefined && (
        <p className="mt-1 text-[13px] text-red-800">
          Nothing came back for this vendor — where the money would go and what is owed are both unknown.
          That is a failed lookup, not a vendor with no details.
        </p>
      )}

      {isOpen && (
        <div onClick={(e) => e.stopPropagation()} className="mt-3 space-y-3 pr-1">
          {/* TWO PANELS, NOT ONE. They answer different questions — where does
              the money go, and what is it settling — and merging them gives a
              block nobody reads. */}
          <WhereItGoes vendor={vendor} />
          <WhatThisSettles
            bills={bills}
            amountPaise={askPaise}
            outstanding={vendor?.outstanding ?? null}
            showAll={showAll}
            onShowAll={() => setShowAll(true)}
          />
          {numbers !== undefined && <BillNumberGap g={numbers} vendorName={row.from_name ?? 'this vendor'} />}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={fieldLabelCls}>Mode</span>
              <input
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className={inputCls}
                maxLength={40}
              />
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
            <Honesty verdict="not enough in it">
              {chosen.name} holds {formatMoneyString(chosen.balance)} and this is{' '}
              {formatMoneyString(row.amount ?? '0')}. If it cannot go from there, send it back rather than
              recording a payment the account cannot carry.
            </Honesty>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={fieldLabelCls}>Date paid</span>
              <input
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Note — required to send it back</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={inputCls}
                maxLength={300}
              />
            </label>
          </div>

          {error !== null && (
            <Honesty verdict="Nothing was written" level="alarm">
              {error}
            </Honesty>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => run('pay')}
              disabled={busy !== null || mode === '' || accountId === '' || paidDate === ''}
              className={btnCls}
            >
              {busy === 'pay' ? 'Recording…' : 'I paid it — record it'}
            </button>
            {/* NOT "REFUSE". The owner decided this should be paid; the
                accountant is declining to EXECUTE and handing the decision
                back. The label has to say which of those it is. */}
            {row.assigned_to !== 'owner' && (
              <button
                type="button"
                onClick={() => run('back')}
                disabled={busy !== null || note.trim() === ''}
                className={btnGhostCls}
              >
                {busy === 'back' ? 'Sending…' : 'Send it back'}
              </button>
            )}
          </div>

          {/* THE CONTROL MODEL, IN ONE SENTENCE. It is the only place the
              division of authority is stated on this screen. */}
          <p className="text-xs text-stone-500">
            You are not approving these bills — the owner did. Sending it back returns it to him with your
            note; he decides whether to route it differently or drop it.
          </p>
        </div>
      )}
    </li>
  )
}

/** WHERE IT GOES — typed into a banking app under time pressure, so the
 *  machine does the copying. A vendor missing a detail says WHICH is missing
 *  rather than showing a blank: 32 of 39 have bank details and 7 have none at
 *  all, and "no IFSC on record" is a thing somebody can go and fix. */
function WhereItGoes({ vendor }: { vendor: VendorRouting | undefined }) {
  if (vendor === undefined) return null
  const missing = [
    vendor.bank_name === null || vendor.bank_name === '' ? 'bank name' : null,
    vendor.account_no === null || vendor.account_no === '' ? 'account number' : null,
    vendor.ifsc === null || vendor.ifsc === '' ? 'IFSC' : null,
  ].filter((m): m is string => m !== null)

  return (
    <div className="rounded-xl border border-rule bg-white p-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">Where it goes</h4>
      {vendor.account_no !== null && vendor.account_no !== '' ? (
        <div className="mt-1">
          {vendor.bank_name !== null && vendor.bank_name !== '' && (
            <CopyField label="Bank" value={vendor.bank_name} />
          )}
          <CopyField label="Account number" value={vendor.account_no} group />
          {vendor.ifsc !== null && vendor.ifsc !== '' && <CopyField label="IFSC" value={vendor.ifsc} />}
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-stone-700">
          {vendor.name} has no account number on record, so no transfer can be made to them. Add it on the
          vendor, or send this back.
        </p>
      )}
      {missing.length > 0 && vendor.account_no !== null && vendor.account_no !== '' && (
        <p className="mt-1.5 text-xs text-amber-800">
          No {missing.join(' and no ')} on record — a transfer usually needs {missing.length === 1 ? 'it' : 'them'}.
        </p>
      )}
    </div>
  )
}

/** WHAT THIS SETTLES — the composition, FIFO, and where the money runs out. */
function WhatThisSettles({
  bills,
  amountPaise,
  outstanding,
  showAll,
  onShowAll,
}: {
  bills: BillOutstandingRow[]
  amountPaise: number
  outstanding: string | null
  showAll: boolean
  onShowAll: () => void
}) {
  const { rows, clears, leftUnapplied } = applyFifo(bills, amountPaise)
  const shown = showAll ? rows : rows.slice(0, 5)
  const hidden = rows.length - shown.length

  return (
    <div className="rounded-xl border border-rule bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">What this settles</h4>
        <span className="text-xs text-stone-400">bills_outstanding · oldest first</span>
      </div>
      {bills.length === 0 ? (
        <p className="mt-1.5 text-sm text-stone-700">
          {outstanding === null
            ? 'Nothing is outstanding to them today — it was settled after this was asked.'
            : 'No open bills came back for this vendor, so nothing here can say what the balance is made of. That is a failed read, not a settled account.'}
        </p>
      ) : (
        <>
          <ul className="mt-1.5 space-y-0.5">
            {shown.map((s) => (
              <li
                key={s.bill.purchase_id}
                className={`flex items-baseline justify-between gap-2 text-xs ${
                  s.fate === 'untouched' ? 'text-stone-400' : 'text-stone-600'
                }`}
              >
                <span className="truncate">
                  {s.bill.bill_no ?? 'no bill no'} · {fmtDate(s.bill.bill_date)}
                  {s.fate === 'partial' && (
                    <span className="ml-1.5 font-semibold text-amber-800">part — the money runs out here</span>
                  )}
                  {s.fate === 'untouched' && <span className="ml-1.5">not covered</span>}
                </span>
                <span className="shrink-0 tabular-nums">
                  {s.fate === 'partial' ? (
                    <>
                      {formatMoneyString(s.applied)}{' '}
                      <span className="text-stone-400">of {formatMoneyString(s.bill.unpaid)}</span>
                    </>
                  ) : (
                    formatMoneyString(s.bill.unpaid)
                  )}
                </span>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              onClick={onShowAll}
              className="mt-1.5 text-xs font-medium text-emerald-700 hover:underline"
            >
              show the other {hidden} →
            </button>
          )}
          <p className="mt-2 border-t border-rule-soft pt-2 text-xs text-stone-600">
            {clears === rows.length && leftUnapplied === 0 ? (
              <>Clears all {rows.length} {rows.length === 1 ? 'bill' : 'bills'} — they will owe nothing.</>
            ) : leftUnapplied > 0 ? (
              <>
                Clears all {rows.length} and leaves {formatMoneyString(String(leftUnapplied / 100))} over — an
                advance against their next bill.
              </>
            ) : (
              <>
                Clears {clears} of {rows.length}
                {rows.some((s) => s.fate === 'partial') && <>, part of one more</>}. The rest stay open.
              </>
            )}
          </p>
        </>
      )}
    </div>
  )
}
