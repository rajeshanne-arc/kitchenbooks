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

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdvanceOutstanding, MoneyAccount } from '@/lib/types'
import { saveAdvance } from '@/server/payroll-actions'
import { decimalStringToPaise, formatMoneyString, formatPaise, parseMoney } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
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
  const [busy, setBusy] = useState(false)

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
      })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      toast('Advance recorded', 'ok')
      setStaffId('')
      setAmount('')
      setAccountId('')
      setNote('')
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
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Lend against wages</h2>
      <p className="mt-1 text-xs text-stone-500">
        One advance, one entry. It takes an ADV number like every other payment.
      </p>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className={fieldLabelCls}>Who</span>
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={selectCls}>
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
  )
}
