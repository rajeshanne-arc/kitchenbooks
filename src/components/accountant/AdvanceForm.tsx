'use client'

// Recording an advance: money lent today against wages not yet earned.
//
// THE ROSTER ARRIVES NARROWED — id, code, name, nothing else. The read behind
// it carries bank accounts, PAN, UAN and dates of birth; this screen is about
// money owed, and an identifier shown where it is not needed is an identifier
// leaked. Narrowing on the server also keeps them out of the payload the
// browser is sent, which a client-side filter would not.
//
// The chosen person's existing balance is stated before the amount is typed:
// lending to someone who already owes ₹4,000 is a different decision from
// lending to someone who owes nothing, and the accountant should not have to
// carry that in their head.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdvanceOutstanding, MoneyAccount, SaveAdvanceResult } from '@/lib/types'
import { loadFulfillable, saveAdvance } from '@/server/payroll-actions'
import { decimalStringToPaise, formatMoneyString, formatPaise, parseMoney } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
import SaveAck from '@/components/SaveAck'
import { addMonths, monthLabel } from '@/lib/advances'
import type { FulfillableRequest } from '@/server/advances-queries'
import PersonLink from '@/components/labour/PersonLink'
import Honesty from '@/components/Honesty'
import {
  btnCls,
  cardCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'
import { toast } from '@/components/Toasts'
import { useBusinessToday } from '@/components/BusinessDay'

/** What this screen is allowed to know about a person. `contract` is not an
 *  identifier — it is the one employment fact this form has to act on, because
 *  a run never carries a contract worker and a run is the only thing that
 *  recovers an advance. */
export type AdvancePerson = { id: string; code: string; name: string; contract: boolean }

export default function AdvanceForm({
  people,
  outstanding,
  accounts,
}: {
  people: AdvancePerson[]
  outstanding: AdvanceOutstanding[]
  accounts: MoneyAccount[]
}) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const [advDate, setAdvDate] = useState(businessToday)
  const [staffId, setStaffId] = useState('')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  const [note, setNote] = useState('')
  // A LOAN IS AN ADVANCE WITH AN INSTALMENT — there is no kind flag and there
  // must not be one: the column comment says the category is derived from
  // this, so a second field saying the same thing is one more place for the
  // two to disagree.
  const [instalment, setInstalment] = useState('')
  // COMPUTED AND SHOWN, NOT TYPED — but editable, because the owner may know a
  // different last date than the arithmetic implies. A mismatch is his to
  // state and is not an error; `touchedEnd` is what stops the computed value
  // overwriting what he chose.
  const [expectedEnd, setExpectedEnd] = useState('')
  const [touchedEnd, setTouchedEnd] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [requests, setRequests] = useState<FulfillableRequest[]>([])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<Extract<SaveAdvanceResult, { ok: true }> | null>(null)

  const person = people.find((p) => p.id === staffId) ?? null
  const already = outstanding.find((o) => o.staff_id === staffId) ?? null
  // a balance can sit BELOW zero — more recovered than was ever lent. That is
  // not a debt and must not be worded as one.
  const owed = already === null ? null : decimalStringToPaise(already.outstanding)
  const canSave =
    !busy &&
    advDate !== '' &&
    staffId !== '' &&
    accountId !== '' &&
    (parseMoney(amount.trim()) ?? 0) > 0

  const amountPaise = parseMoney(amount.trim())
  const instPaise = instalment.trim() === '' ? null : parseMoney(instalment.trim())
  const instTooBig = amountPaise !== null && instPaise !== null && instPaise > amountPaise
  const months =
    amountPaise !== null && instPaise !== null && instPaise > 0 && !instTooBig
      ? Math.ceil(amountPaise / instPaise)
      : null
  const computedEnd = months === null ? '' : addMonths(advDate, months - 1)
  const endToShow = touchedEnd ? expectedEnd : computedEnd

  // WHOSE APPROVED REQUESTS ARE STILL WAITING. Loaded when the person is
  // chosen, because an approval nobody records leaves an owner asked twice.
  // NOTHING IS CLEARED HERE. `react-hooks/set-state-in-effect` is right to
  // refuse a synchronous write from an effect — it is the shape that caused
  // the letterhead remount — so choosing a different person clears the picker
  // in the SELECT's own handler, which is a user event, and this only ever
  // fetches. The setState calls live in the `.then()`, the form BillSheet
  // already uses for the same reason.
  useEffect(() => {
    if (staffId === '') return
    let live = true
    loadFulfillable(staffId)
      .then((rs) => {
        if (live) setRequests(rs)
      })
      .catch(() => {
        if (live) setRequests([])
      })
    return () => {
      live = false
    }
  }, [staffId])

  async function save() {
    if (!canSave) return
    setBusy(true)
    try {
      const res = await saveAdvance({
        date: advDate,
        staffId,
        amount: amount.trim(),
        accountId,
        note: note.trim(),
        instalment: instalment.trim(),
        expectedEnd: endToShow,
        approvedRequestId: requestId,
      })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      setSaved(res)
      setStaffId('')
      setAmount('')
      setAccountId('')
      setNote('')
      setInstalment('')
      setExpectedEnd('')
      setTouchedEnd(false)
      setRequestId('')
      // the balance above is re-read from the database, never echoed from here
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was recorded.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (people.length === 0) {
    return (
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Lend against wages</h2>
        <p className="mt-1.5 text-sm text-stone-700">
          Nobody is on the active roster, so there is nobody to advance money to. The manager adds
          people on the staff roster — not a screen the accountant can open — and they appear here
          as soon as they are on it; someone who has left is not offered, because an advance is
          repaid out of wages still to be earned.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      {saved !== null && (
        <SaveAck
          onDismiss={() => setSaved(null)}
          headline={
            <>
              {saved.staffName ?? 'They'} now owes{' '}
              <span className="tabular-nums">{formatMoneyString(saved.outstanding)}</span> against wages
            </>
          }
          sub={
            saved.months === null
              ? 'the payroll draft offers this back as recovery on the next run, editable until the run is prepared'
              : `a loan: ${formatMoneyString(saved.instalment ?? '0')} a month over ${saved.months} instalment${saved.months === 1 ? '' : 's'}${saved.expectedEnd === null ? '' : `, ending ${monthLabel(saved.expectedEnd)}`} — the draft offers the INSTALMENT back each run, not the whole balance`
          }
        >
          {saved.fulfilled && (
            <p className="text-[13px] text-stone-700">
              The approved request it settles is closed, so nobody will be asked for the same money
              twice.
            </p>
          )}
        </SaveAck>
      )}
      <section className={cardCls}>
      <h2 className={sectionHeadCls}>Lend against wages</h2>
      <p className="mt-1 text-xs text-stone-500">
        One advance, one entry. It takes an ADV number like every other payment.
      </p>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className={fieldLabelCls}>Who</span>
          <select
            value={staffId}
            onChange={(e) => {
              // A DIFFERENT PERSON HAS DIFFERENT APPROVALS. Clearing here
              // rather than in the effect keeps the write on a user event, and
              // stops a request approved for somebody else staying selected.
              setStaffId(e.target.value)
              setRequests([])
              setRequestId('')
            }}
            className={selectCls}
          >
            <option value="">—</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.code}
              </option>
            ))}
          </select>
          {already !== null && owed !== null && owed > 0 && (
            <span className="mt-1 block text-xs text-amber-800">
              already owes {formatMoneyString(already.outstanding)}
              {already.last_advance !== null && `, last advanced ${fmtDate(already.last_advance)}`} —
              this one adds to that.
            </span>
          )}
          {already !== null && owed !== null && owed < 0 && (
            <span className="mt-1 block text-xs text-red-800">
              has had {formatPaise(-owed)} MORE recovered than was ever lent — they are not in debt,
              a wage deduction was taken that nobody owed. This advance nets against that before
              anything is owed back.
            </span>
          )}
        </label>

        {/* A NAME IN A <select> CANNOT BE A LINK, so the door goes here, on
            the person who has actually been chosen — which is the better
            place anyway: the question an accountant has once they have picked
            somebody is what else that person already has against them. */}
        {person !== null && (
          <p className="text-xs text-stone-500">
            <PersonLink
              code={person.code}
              name={`${person.name} · ${person.code}`}
              className="font-medium text-emerald-800"
            />{' '}
            — attendance, runs and advances
          </p>
        )}

        {/* The advance mechanic has exactly one way back: `advance_recovered`
            on a payroll line. A contract worker never reaches one. */}
        {person !== null && person.contract && (
          <Honesty verdict="never on a run">
            {person.name} is contract — billed by their vendor, so they never appear on a payroll
            run. Recovery only ever happens on a run, so nothing in the app will bring this money
            back: the balance above will go on saying it is owed until it is settled with their
            vendor off these books.
          </Honesty>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Date</span>
            <input
              type="date"
              value={advDate}
              onChange={(e) => setAdvDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Amount</span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${numCls} w-full text-right`}
            />
          </label>
        </div>

        {/* AN INSTALMENT MAKES IT A LOAN. Blank means the whole advance is
            recovered at the next payroll; a figure means a slice a month, and
            the end date is worked out rather than guessed at. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabelCls}>Taken back each month</span>
            <input
              inputMode="decimal"
              placeholder="blank = all of it at the next payroll"
              value={instalment}
              onChange={(e) => setInstalment(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${numCls} w-full text-right`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Last instalment</span>
            <input
              type="date"
              value={endToShow}
              disabled={months === null}
              onChange={(e) => {
                setTouchedEnd(true)
                setExpectedEnd(e.target.value)
              }}
              className={inputCls}
            />
          </label>
        </div>
        {instTooBig && (
          <p className="text-xs font-medium text-red-700">
            That instalment is more than the advance. Leave it blank to take the whole thing back at
            once.
          </p>
        )}
        {months !== null && (
          <p className="text-xs text-stone-600">
            {formatMoneyString(amount.trim())} at {formatMoneyString(instalment.trim())} a month —{' '}
            {months} instalment{months === 1 ? '' : 's'}, ending {monthLabel(endToShow)}.
            {touchedEnd && computedEnd !== expectedEnd && (
              <span className="text-stone-500">
                {' '}
                The arithmetic says {monthLabel(computedEnd)}; you have said otherwise, which is
                allowed — it is your date, not a correction.
              </span>
            )}{' '}
            No interest is charged.
          </p>
        )}

        {/* AN APPROVED REQUEST THIS SETTLES. Optional: the owner lending from
            his own account needs no approval from himself. But an approval
            nobody records stays open forever beside a row that quietly
            satisfied it, which is how somebody gets asked twice. */}
        {requests.length > 0 && (
          <label className="block">
            <span className={fieldLabelCls}>Settles an approved request</span>
            <select
              value={requestId}
              onChange={(e) => {
                const id = e.target.value
                setRequestId(id)
                const r = requests.find((x) => x.id === id)
                // PREFILLED FROM WHAT WAS APPROVED, not retyped. The owner
                // agreed to a figure and a shape; making somebody key them
                // again is how the recorded advance stops matching the
                // decision behind it.
                if (r !== undefined) {
                  setAmount(r.amount)
                  if (r.instalment !== null) setInstalment(r.instalment)
                  if (r.expected_end !== null) {
                    setExpectedEnd(r.expected_end)
                    setTouchedEnd(true)
                  }
                }
              }}
              className={selectCls}
            >
              <option value="">Not against a request</option>
              {requests.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatMoneyString(r.amount)} — “{r.reason}”
                  {r.decided_by === null ? '' : ` · approved by ${r.decided_by}`}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-stone-500">
              Recording it against a request marks that request settled, so nobody is asked for the
              same money twice.
            </span>
          </label>
        )}

        <AccountPicker
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          label="Paid from"
          hint="the account the cash or transfer actually left"
        />

        <label className="block">
          <span className={fieldLabelCls}>Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="what it was for, or what was agreed about repaying it"
            className={inputCls}
          />
        </label>

        {/* The two things a person recording this needs to know afterwards:
            where the money shows up now, and how it comes back later. */}
        <p className="text-xs text-stone-500">
          This is money leaving an account today, so it lands in the cash and bank registers —
          money_movements reads staff_advances. The payroll run itself does not.
        </p>
        <p className="text-xs text-stone-500">
          It comes back as <span className="font-medium text-stone-700">advance recovered</span> on
          the next payroll draft, prefilled with what is still owed and editable there — a person may
          not repay all of it in one month.
        </p>

        <button type="button" disabled={!canSave} onClick={() => void save()} className={btnCls}>
          {busy ? 'Recording…' : 'Record advance'}
        </button>
      </div>
    </section>
    </div>
  )
}
