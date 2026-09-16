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

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPayment } from '@/server/books-actions'
import { loadVendorBills, requestVendorPayment } from '@/server/approvals-actions'
import type { BillOutstandingRow, MoneyAccount, VendorAgingRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString, formatPaise, parseMoney } from '@/lib/money'
import { isCashMode } from '@/lib/payment-mode'
import { modesForVendor } from '@/lib/payment-routing'
import Honesty from '@/components/Honesty'
import BillSheet from '@/components/books/BillSheet'
import { fmtDate, fmtRange } from '@/lib/format'
import { defaultRange, inRange, ordered, totalPaise, type DateRange } from '@/lib/bill-range'
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
  | {
      kind: 'asked'
      vendorName: string
      amount: string
      mode: string
      stillOwed: string
      /** READ BACK from the raise rather than counted off the preview — the
       *  screen's list is what he chose from, the server's figures are what
       *  was written. */
      range: { from: string; to: string; bills: number }
    }

export default function PayOrAsk({
  vendorId,
  vendorName,
  aging,
  accounts,
  modes,
  onDone,
}: {
  vendorId: string
  vendorName: string
  /** null when nothing is outstanding — an advance, or a first payment */
  aging: VendorAgingRow | null
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // WHICH BILLS THIS IS ABOUT — the request branch only. `null` means not
  // fetched yet, which is a different state from "this vendor has none", and
  // the screen says which.
  const [vendorBills, setVendorBills] = useState<BillOutstandingRow[] | null>(null)
  // DERIVED, NOT STORED. Setting a busy flag synchronously at the top of an
  // effect is `react-hooks/static-components`' sibling — the rule that caught
  // the letterhead remount — and it is the same fix BillSheet took: nothing
  // and no error IS reading. A `fetching` ref keeps one read in flight without
  // a render-visible write.
  // BUMPED AFTER A REQUEST IS SENT, which is what re-reads the list. Watching
  // `vendorBills === null` instead would re-fire on every render that cleared
  // it and is one condition away from a loop.
  const [reloadKey, setReloadKey] = useState(0)
  const [billsError, setBillsError] = useState<string | null>(null)
  const [range, setRange] = useState<DateRange>({ from: '', to: businessToday })
  // Once he has typed a figure it is HIS. Narrowing the range after that
  // changes what is being asked about and not what he asked for, and
  // overwriting a typed number would be the app arguing with him.
  const [amountTouched, setAmountTouched] = useState(false)
  // WHETHER THE DATES ARE STILL THE DEFAULT. They lead the form now, so a
  // reader arriving at two filled-in dates has no way to tell a default from a
  // narrowing somebody already applied — and those are different claims about
  // what is being paid.
  const [rangeTouched, setRangeTouched] = useState(false)
  const [showAllBills, setShowAllBills] = useState(false)
  // THE SHEET IS A SIBLING, NOT A ROUTE. Everything typed into this form —
  // the range, the amount, the reason — is still here when it closes, which a
  // navigation to the bill page could never have promised.
  const [openBill, setOpenBill] = useState<string | null>(null)

  const billsBusy = vendorBills === null && billsError === null
  const scopedBills = vendorBills === null ? null : inRange(vendorBills, range)
  const scopedPaise = scopedBills === null ? null : totalPaise(scopedBills)

  /** ONE ROUND TRIP, WHEN THE ROW OPENS.
   *
   *  It used to fire when the REQUEST branch opened, which meant the range and
   *  the bills behind it appeared only after a non-cash mode was chosen — so
   *  somebody opening a row to see which bills he was about to settle found
   *  the old three-and-older summary instead, and cash never saw the
   *  composition at all. The range is WHAT is being paid and the mode is HOW;
   *  the first does not depend on the second, and a cash payment at the door
   *  settles bills exactly as a transfer does.
   *
   *  The queue ships three bills per vendor because a row expands in place and
   *  a payload must not grow with the ledger; choosing a range needs all of
   *  them for ONE vendor, so they are fetched here and every date change
   *  afterwards is arithmetic. */
  // ON MOUNT, AND AGAIN AFTER A REQUEST IS SENT.
  //
  // THE SETSTATE CALLS LIVE IN THE `.then()`, not in a function called from
  // the effect body. `react-hooks/set-state-in-effect` follows the call
  // transitively, and it is right to: a synchronous write from an effect is
  // the shape that caused the letterhead remount. This is the form BillSheet
  // already uses for the same reason.
  //
  // `live` cancels a stale read, so a second row opening while the first is in
  // flight cannot let the slower answer win.
  useEffect(() => {
    let live = true
    loadVendorBills(vendorId)
      .then((res) => {
        if (!live) return
        if (!res.ok) {
          setBillsError(res.error)
          return
        }
        setBillsError(null)
        setVendorBills(res.bills)
        const d = defaultRange(res.bills, businessToday)
        if (d !== null) {
          setRange(d)
          if (!amountTouched) setAmount((totalPaise(inRange(res.bills, d)) / 100).toFixed(2))
        }
      })
      .catch(() => {
        if (live) {
          setBillsError('Could not load this vendor’s bills — the range cannot be checked against anything.')
        }
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, reloadKey])

  /** The amount follows the range until he takes it over. */
  function moveRange(next: DateRange) {
    setRange(next)
    setRangeTouched(true)
    setShowAllBills(false)
    if (!amountTouched && vendorBills !== null) {
      setAmount((totalPaise(inRange(vendorBills, next)) / 100).toFixed(2))
    }
  }

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

  const amountPaise = parseMoney(amount.trim())
  // THE BOUND IS THE RANGE, NOT THE BALANCE. With the default range those are
  // the same number by construction — it covers every unpaid bill — and they
  // stop being the same the moment he narrows it, which is the whole point.
  const over = amountPaise !== null && scopedPaise !== null && amountPaise > scopedPaise

  const base = !busy && amountPaise !== null && amountPaise > 0 && mode !== ''
  const canSave = cash
    ? base && !noCashAccount && paidDate !== '' && accountId !== ''
    : base &&
      note.trim() !== '' &&
      ordered(range) &&
      scopedBills !== null &&
      scopedBills.length > 0 &&
      !over

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
          billsFrom: range.from,
          billsTo: range.to,
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
          range: { from: res.range.from, to: res.range.to, bills: res.range.bills },
        })
      }
      setAmount('')
      setAmountTouched(false)
      setAccountId('')
      setNote('')
      // The next ask for this vendor is a different range over the same bills,
      // and one of them has just been claimed — so the list is re-read rather
      // than reused. Nulling it is what the mount effect watches, so the
      // re-read happens rather than the form going dead.
      setRangeTouched(false)
      setVendorBills(null)
      setReloadKey((k) => k + 1)
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
      {/* AN EMPTY COMPOSITION IS ONLY HONEST IF THERE IS NOTHING TO COMPOSE.
          `bills` is a map keyed by vendor id, so a missing key renders exactly
          like a vendor with no open bills — and the ageing row already carries
          the count, which is a second source that can contradict it. A figure
          with no composition is a figure nobody can check; a figure whose
          composition silently failed to arrive is worse, because the screen
          looks complete. */}
      {/* AN HONEST EMPTY STATE CAN ABSORB A BROKEN READ, and this is the one
          place on this form where it could.
          BillRange's own empty state says "{vendor} has no unpaid bills, so
          there is no range to ask about" — which is the right sentence for a
          vendor who genuinely owes nothing, and the SAME sentence for a read
          that failed and came back with none. Identical on screen, by
          construction. That is the fault recorded on 15 Sept: `snapshot` was
          corrupted on every request ever made and every surface rendered "no
          snapshot recorded", so a silent corruption looked exactly like a
          correctly reported gap for the life of the feature.
          WHAT BREAKS THE TIE IS A SECOND SOURCE. `vendor_aging.open_bills` is
          counted independently of this read, so a non-zero count beside an
          empty composition is a contradiction rather than a gap — and it is
          the only thing here that can tell the two apart.
          IT CAME FROM THE SUMMARY THIS COMMIT DELETED. Noticing it while
          removing the block that provided it is the good case; the bad one is
          deleting the block, keeping the honest empty state, and shipping a
          screen that cannot distinguish an empty read from an empty account. */}
      {aging !== null && aging.open_bills > 0 && vendorBills !== null && vendorBills.length === 0 && (
        <div className="pb-2">
          <Honesty verdict="bills did not load" level="alarm">
            {aging.vendor_name} has {aging.open_bills}{' '}
            {aging.open_bills === 1 ? 'open bill' : 'open bills'} behind{' '}
            {formatMoneyString(aging.outstanding)} and none of them came back, so nothing here can say what
            this balance is made of. That is a failed read, not a settled account.
          </Honesty>
        </div>
      )}

      {/* ALWAYS, FROM THE MOMENT THE ROW OPENS — cash included. */}
      {(
        <BillRange
          untouched={!rangeTouched}
          vendorName={vendorName}
          loaded={vendorBills !== null}
          scoped={scopedBills}
          scopedPaise={scopedPaise}
          range={range}
          onRange={moveRange}
          busy={billsBusy}
          error={billsError}
          showAll={showAllBills}
          onShowAll={() => setShowAllBills(true)}
          onOpenBill={setOpenBill}
        />
      )}

      {openBill !== null && (
        <BillSheet key={openBill} purchaseId={openBill} onClose={() => setOpenBill(null)} />
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
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^\d.]/g, ''))
                setAmountTouched(true)
              }}
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
            <select
              value={mode}
              onChange={(e) => {
                const next = e.target.value
                setMode(next)
                // NOTHING TO FETCH HERE ANY MORE. The bills arrive when the
                // ROW opens, because the range is what is being paid and does
                // not depend on how the money goes.
              }}
              className={selectCls}
            >
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

      {/* OVER THE RANGE IS NOW A REFUSAL, NOT A TICK. It used to offer an
          advance override here; the server refuses it outright, so an amount
          above the bills in range is said BEFORE the button rather than at
          save — a refusal at save is a refusal after the work. Where advances
          live is named, because a dead end is worse than a no. */}
      {over && (
        <div className="mt-3">
          <Honesty verdict="more than the bills in range" level="alarm">
            The bills between {fmtRange(range.from, range.to)} come to{' '}
            {formatPaise(scopedPaise ?? 0)} and this asks for {formatPaise(parseMoney(amount) ?? 0)}. Lower
            it, or widen the range. If you mean to pay them ahead of their bills, ask for an ADVANCE
            instead — it is its own kind of request, it needs no bills behind it, and the owner
            decides it because he is the one who can see the cash.
          </Honesty>
        </div>
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
 * WHICH BILLS, AND WHAT THEY COME TO.
 *
 * THE SAME SHAPE AS THE ACCOUNTANT'S DISCLOSURE — five rows, then the rest
 * behind one line, then the total — because it is the same act read from the
 * other end: he is choosing what to ask for, and the accountant is checking
 * what was asked. Two different shapes for one composition would make them
 * compare two things.
 *
 * AND IT IS A DISCLOSURE, NOT AN APPROVAL STEP. There are no per-bill
 * checkboxes here for the same reason there are none there: ticking bills
 * would imply a payment lands against the ones ticked, and it does not —
 * payments are ON ACCOUNT and allocate FIFO. The range says which bills people
 * are TALKING about. The ledger still sees money against a balance.
 *
 * NOT LOADED IS NOT EMPTY. A vendor with no bills in the chosen range and a
 * vendor whose bills have not arrived are different facts, and an empty list
 * would render identically for both — the honest-empty-state trap this
 * codebase has already paid for once.
 */
function BillRange({
  untouched,
  vendorName,
  loaded,
  scoped,
  scopedPaise,
  range,
  onRange,
  busy,
  error,
  showAll,
  onShowAll,
  onOpenBill,
}: {
  untouched: boolean
  vendorName: string
  loaded: boolean
  scoped: BillOutstandingRow[] | null
  scopedPaise: number | null
  range: DateRange
  onRange: (r: DateRange) => void
  busy: boolean
  error: string | null
  showAll: boolean
  onShowAll: () => void
  onOpenBill: (purchaseId: string) => void
}) {
  const shown = scoped === null ? [] : showAll ? scoped : scoped.slice(0, 5)
  const hidden = scoped === null ? 0 : scoped.length - shown.length
  const backwards = loaded && range.from !== '' && !ordered(range)

  return (
    <div className="border-b border-rule-soft pb-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelCls}>Bills from</span>
          <input
            type="date"
            value={range.from}
            disabled={!loaded}
            onChange={(e) => onRange({ ...range, from: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>up to and including</span>
          <input
            type="date"
            value={range.to}
            disabled={!loaded}
            onChange={(e) => onRange({ ...range, to: e.target.value })}
            className={inputCls}
          />
        </label>
      </div>

      {/* SAY THAT IT IS A DEFAULT. Two filled-in dates leading the form look
          exactly like a narrowing somebody already applied, and those are
          different claims about what is being paid. It goes quiet the moment
          he moves either end, because then it IS a narrowing. */}
      {untouched && loaded && !busy && range.from !== '' && (
        <p className="mt-1.5 text-xs text-stone-500">
          Every unpaid bill — the dates are a default, not a narrowing. Change either to ask about less.
        </p>
      )}

      {busy && <p className="mt-2 text-xs text-stone-400">Reading {vendorName}’s unpaid bills…</p>}

      {error !== null && (
        <div className="mt-2">
          <Honesty verdict="bills did not load" level="alarm">
            {error} Nothing here can say what a range covers, so the figure would be a number with no
            composition behind it.
          </Honesty>
        </div>
      )}

      {backwards && (
        <p className="mt-2 text-xs font-medium text-red-700">
          That range starts after it ends. Swap the two dates.
        </p>
      )}

      {/* NOTHING AT ALL IS NOT NOTHING IN THIS RANGE. A vendor with no unpaid
          bill has no oldest bill date either, so there is no range to name —
          and `fmtRange('', …)` would put "Invalid Date" on the screen, which
          is the same class of fault as rendering "undefined". Said as its own
          sentence rather than squeezed through the range one. */}
      {loaded && range.from === '' && (
        <div className="mt-2">
          <Honesty verdict="nothing outstanding">
            {vendorName} has no unpaid bills, so there is no range to ask about. If this is an advance,
            record it as one rather than as a payment against bills.
          </Honesty>
        </div>
      )}

      {loaded && range.from !== '' && !backwards && scoped !== null && scoped.length === 0 && (
        <div className="mt-2">
          <Honesty verdict="nothing in this range">
            No unpaid bill for {vendorName} falls between {fmtRange(range.from, range.to)}. Widen it — there
            is nothing in there to ask for.
          </Honesty>
        </div>
      )}

      {loaded && range.from !== '' && !backwards && scoped !== null && scoped.length > 0 && (
        <>
          <ul className="mt-2 space-y-0.5">
            {shown.map((b) => (
              <li key={b.purchase_id}>
                {/* THE ROW IS THE CONTROL, and it is a real button so a
                    keyboard reaches it — the clipped-action lesson, which was
                    about a control nobody could get to. */}
                <button
                  type="button"
                  onClick={() => onOpenBill(b.purchase_id)}
                  className="flex w-full justify-between gap-2 rounded px-1 py-0.5 text-left text-xs text-stone-500 hover:bg-stone-50"
                >
                  <span className="truncate">
                    {b.bill_no ?? 'no bill no'} · {fmtDate(b.bill_date)}
                    {b.due_date !== null && (
                      <span className="text-stone-400"> · due {fmtDate(b.due_date)}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatMoneyString(b.unpaid)}</span>
                </button>
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
          <p className="mt-2 flex justify-between gap-2 border-t border-rule-soft pt-2 text-xs text-stone-600">
            <span>
              {scoped.length} {scoped.length === 1 ? 'bill' : 'bills'} · {fmtRange(range.from, range.to)}
            </span>
            <span className="font-semibold tabular-nums text-stone-900">
              {formatPaise(scopedPaise ?? 0)}
            </span>
          </p>
        </>
      )}
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
            <span className="tabular-nums">{formatMoneyString(ack.amount)}</span> for bills{' '}
            {fmtRange(ack.range.from, ack.range.to)}{' '}
            <span className="text-stone-500">
              ({ack.range.bills} {ack.range.bills === 1 ? 'bill' : 'bills'})
            </span>
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
