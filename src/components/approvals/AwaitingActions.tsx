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
import NameFigure from '@/components/NameFigure'
import BillScope from '@/components/approvals/BillScope'
import BillDrift from '@/components/approvals/BillDrift'
import { payApproval, returnRequest } from '@/server/approvals-actions'
import type { AwaitingRow, RangeScope, VendorRouting } from '@/server/approvals-queries'
import type { AccountBalanceRow, BillOutstandingRow } from '@/lib/types'
import type { BillNumbers } from '@/lib/bill-gaps'
import { applyFifo } from '@/lib/settle'
import { inRange, type DateRange } from '@/lib/bill-range'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime, fmtRange } from '@/lib/format'
import { lateness, LATE_TONE } from '@/lib/lateness'
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
  scope,
  balances,
  today,
  mine,
  role,
}: {
  rows: AwaitingRow[]
  vendors: Record<string, VendorRouting>
  bills: Record<string, BillOutstandingRow[]>
  numbers: Record<string, BillNumbers>
  /** keyed by REQUEST id — the live total of the bills each one names */
  scope: Record<string, RangeScope>
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
    <section className={`${cardCls} mb-4`}>
      <h2 className={sectionHeadCls}>{mine ? 'Routed to you' : `Routed to the ${role}`}</h2>
      {/* ONE BLOCK PER REQUEST, WITH A GAP. A hairline divider makes a queue
          read as one object with lines through it; a gap makes each request a
          thing you can look at on its own, which is what somebody working
          down a list is actually doing. It also gives the ageing somewhere to
          live — a border belongs to a block and cannot belong to a row in a
          divided list. */}
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <Row
            key={r.id}
            row={r}
            vendor={vendors[r.entity_id]}
            bills={bills[r.entity_id] ?? []}
            numbers={numbers[r.entity_id]}
            scope={scope[r.id]}
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
  scope,
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
  scope: RangeScope | undefined
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

  // URGENCY IS DERIVED FROM THE AGEING, NEVER DECLARED, and it is said in
  // words as well as coloured. `today` is the BUSINESS day, handed down from
  // the page — the browser clock says tomorrow at 00:30 and would age every
  // vendor by a day for two hours a night.
  //
  // A FAILED LOOKUP IS NOT A VENDOR WITH NO DUE DATE. Where nothing came back
  // there is no band to state, so no chip is drawn at all and the red sentence
  // below is left to say what happened — a cheerful “no due date on the
  // books” over a failed read would be a claim the data cannot support.
  const late = vendor === undefined ? null : lateness(vendor.oldest_due, today)
  const tone = late === null ? { border: 'border-red-300', chip: '' } : LATE_TONE[late.band]

  return (
    <li
      onClick={onToggle}
      className={`relative cursor-pointer rounded-xl border bg-white p-3 transition ${tone.border} ${
        isOpen
          ? 'bg-amber-50/70 shadow-sm'
          : dimmed
            ? 'opacity-45 hover:opacity-80'
            : 'hover:bg-stone-50'
      }`}
    >
      {/* THE OPEN BLOCK IS LIFTED THREE WAYS AT ONCE — tinted, barred down its
          left edge, and every other block dimmed — because any one alone is
          missable on a long queue. The bar is AMBER and the border is the
          AGEING, so the two signals never compete for the same edge. */}
      {isOpen && <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-amber-500" />}

      {/* THE FIGURE GETS ITS OWN COLUMN, so several blocks line up as a column
          a reader can compare down. The top line carries the name and the
          amount and nothing else. */}
      <NameFigure
        name={row.from_name ?? 'a vendor'}
        figure={row.amount === null ? '—' : formatMoneyString(row.amount)}
      />

      {/* THE SECOND LINE CARRIES EVERYTHING ELSE — how late, who asked, WHEN
          (the date as well as the time: “2:55 pm” alone leaves a reader
          guessing which day, and a request sitting for a fortnight looks
          identical to one raised this afternoon), and the mode. */}
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
        {late !== null && (
          <span className={`rounded-full border px-1.5 py-0.5 font-medium ${tone.chip}`}>{late.text}</span>
        )}
        <BillScope kind={row.kind} from={row.bills_from} to={row.bills_to} snapshot={row.snapshot} />
        <span>
          {row.requested_by ?? 'someone'} · {fmtDateTime(row.requested_at)}
        </span>
        {row.routed_mode !== null && <span>· by {row.routed_mode}</span>}
      </p>

      <p className="mt-1.5 text-[13px] text-stone-600">“{row.reason}”</p>
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
            range={
              row.bills_from !== null && row.bills_to !== null
                ? { from: row.bills_from, to: row.bills_to }
                : null
            }
            amountPaise={askPaise}
            outstanding={vendor?.outstanding ?? null}
            showAll={showAll}
            onShowAll={() => setShowAll(true)}
          />
          {numbers !== undefined && <BillNumberGap g={numbers} vendorName={row.from_name ?? 'this vendor'} />}

          {/* SAID BEFORE THE BUTTON. The server refuses this under a row lock
              — a screen is never the check — but a refusal at save is a
              refusal after the work. */}
          <BillDrift asked={row.amount} scope={scope} from={row.bills_from} to={row.bills_to} />

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

/**
 * WHAT THIS SETTLES — the composition, FIFO, and where the money runs out.
 *
 * SCOPED TO THE RANGE THE REQUEST NAMES, because that is what he is being
 * asked to pay. A pre-range request names none and shows the whole balance,
 * which is what it always meant.
 *
 * AND THE SPLIT IS STILL FIFO OVER EVERYTHING, WHICH IS NOT THE SAME THING.
 * This is the one place the two can come apart, so it is worth being exact:
 *
 *   the RANGE says which bills two people agreed this payment is about;
 *   the LEDGER puts money against a BALANCE, oldest first, because payments
 *   here are ON ACCOUNT and tied to no bill.
 *
 * With the default range those coincide — it starts at the oldest unpaid bill,
 * so FIFO and the range walk the same list. They separate the moment somebody
 * narrows the range and leaves something older outside it, and then the money
 * clears the older bills FIRST whatever the request says. That is a real
 * finding for the person about to pay it, so it is on screen rather than only
 * in this comment.
 *
 * DO NOT "FIX" THIS BY ALLOCATING FIFO OVER THE SCOPED LIST. It would make the
 * screen agree with itself and disagree with the ledger, which is the worse of
 * the two — and per-bill allocation is a different product with a join table
 * and no way to read the payments already on these books.
 */
function WhatThisSettles({
  bills,
  range,
  amountPaise,
  outstanding,
  showAll,
  onShowAll,
}: {
  bills: BillOutstandingRow[]
  /** null on a pre-range request — a claim on the whole balance */
  range: DateRange | null
  amountPaise: number
  outstanding: string | null
  showAll: boolean
  onShowAll: () => void
}) {
  const scoped = range === null ? bills : inRange(bills, range)
  const { rows, clears, leftUnapplied } = applyFifo(scoped, amountPaise)
  const shown = showAll ? rows : rows.slice(0, 5)
  const hidden = rows.length - shown.length
  // OLDER THAN THE RANGE, and therefore first in the queue for this money.
  const olderOutside =
    range === null ? [] : bills.filter((b) => b.bill_date < range.from && b.unpaid !== '0')

  return (
    <div className="rounded-xl border border-rule bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">
          What this settles
          {range !== null && (
            <span className="ml-1 normal-case tracking-normal text-stone-500">
              — {scoped.length} {scoped.length === 1 ? 'bill' : 'bills'}, {fmtRange(range.from, range.to)}
            </span>
          )}
        </h4>
        <span className="text-xs text-stone-400">bills_outstanding · oldest first</span>
      </div>

      {olderOutside.length > 0 && (
        <div className="mt-1.5">
          <Honesty verdict="older bills come first">
            {olderOutside.length} unpaid {olderOutside.length === 1 ? 'bill' : 'bills'} predate this range.
            A payment here is ON ACCOUNT and clears the oldest first, so this money will settle those before
            it reaches the bills named above — the range is what was agreed, not what the ledger does.
          </Honesty>
        </div>
      )}
      {scoped.length === 0 ? (
        <p className="mt-1.5 text-sm text-stone-700">
          {outstanding === null
            ? 'Nothing is outstanding to them today — it was settled after this was asked.'
            : bills.length > 0 && range !== null
              ? `No unpaid bill falls inside ${fmtRange(range.from, range.to)} any more — every bill this request named has been settled since it was raised.`
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
