'use client'

// Withholdings — money kept back from a payment because it is owed to a
// revenue authority rather than to the person being paid.
//
// RECORD WHAT WAS WITHHELD, NEVER COMPUTE A RATE. The form asks two
// amounts: what the payment was, and what was held back. The rate is
// whatever those two work out to, worked out on the server for display and
// never offered as a field — because a rate field asks "which rate
// applies?", and answering that is filing advice. TDS in India, PAYG
// withholding in Australia, backup withholding in the US: every country has
// this shape and no two agree on the rates, the thresholds or the codes.
//
// Which is also why the code is FREE TEXT. It is whatever the customer's own
// paperwork calls it, not a dropdown of one country's sections.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MoneyAccount, WithholdingRow } from '@/lib/types'
import { markWithholdingDeposited, saveWithholding } from '@/server/accountant-actions'
import AccountPicker from '@/components/accounts/AccountPicker'
import { parseDecimal, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty, { HonestyPill } from '@/components/Honesty'
import {
  btnCls,
  btnGhostCls,
  cardCls,
  fieldLabelCls,
  inputCls,
  moneyCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'
import { toast } from '@/components/Toasts'
import SaveAck from '@/components/SaveAck'

/** What the payment WAS — a plain description, not a tax classification.
 *  The authority's own word for it goes in the code field instead. */
const PAYMENT_KINDS: { v: string; label: string }[] = [
  { v: 'payment', label: 'A payment' },
  { v: 'vendor', label: 'A supplier bill' },
  { v: 'contractor', label: 'A contractor' },
  { v: 'rent', label: 'Rent' },
  { v: 'professional', label: 'A professional fee' },
  { v: 'commission', label: 'Commission' },
  { v: 'salary', label: 'Salary or wages' },
]

const kindLabel = (v: string): string => PAYMENT_KINDS.find((k) => k.v === v)?.label ?? v

/** The server's own shape test, so the button is not enabled for a figure the
 *  save would reject out of hand. Its other rule — never more withheld than was
 *  paid — is left to the server, which can say what is wrong in words. */
const okAmount = (s: string): boolean => parseDecimal(s, 2, 11) !== null && Number(s) > 0

export default function WithholdingsPanel({
  accounts,
  rows,
  today,
}: {
  rows: WithholdingRow[]
  /** IST, from the server — the date pickers open on the right day */
  today: string
  accounts: MoneyAccount[]
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)
  const [date, setDate] = useState(today)
  const [party, setParty] = useState('')
  const [entityType, setEntityType] = useState('payment')
  const [regimeCode, setRegimeCode] = useState('')
  const [baseAmount, setBaseAmount] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [depositing, setDepositing] = useState<string | null>(null)
  // nothing preselected: a challan is paid from a real account and the
  // server refuses a blank, same as every other money form
  const [depAccountId, setDepAccountId] = useState('')
  const [depDate, setDepDate] = useState(today)
  const [depRef, setDepRef] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const canSave =
    date !== '' && party.trim() !== '' && okAmount(baseAmount) && okAmount(amount)

  // Not-yet-deposited first: money held back and not paid across is the row
  // that needs doing. Sort is stable, so within each group the server's
  // newest-first order survives untouched.
  const ordered = [...rows].sort(
    (a, b) => Number(a.deposited_on !== null) - Number(b.deposited_on !== null),
  )
  const deposited = rows.filter((r) => r.deposited_on !== null).length
  const owing = rows.length - deposited

  async function save() {
    if (!canSave || busy !== null) return
    setBusy('save')
    try {
      const res = await saveWithholding({
        date,
        party,
        entityType,
        regimeCode,
        baseAmount,
        amount,
        note,
      })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      // rate_pct is DERIVED for display and is never an input — saying it
      // back is the app reporting what was withheld, not advising a rate
setAck({ headline: `${formatMoneyString(amount)} withheld from ${party}`, sub: 'The rate shown is DERIVED from the two amounts for display. No rate is ever computed here — that would be filing advice.' })
      toast(`${formatMoneyString(amount)} withheld from ${party} recorded`, 'ok')
      setParty('')
      setRegimeCode('')
      setBaseAmount('')
      setAmount('')
      setNote('')
      setAdding(false)
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was recorded.', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function deposit(id: string) {
    if (busy !== null || depDate === '' || depAccountId === '') return
    setBusy(id)
    try {
      const res = await markWithholdingDeposited(id, depDate, depRef, depAccountId)
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
setAck({ headline: `Deposited ${fmtDate(depDate)}`, sub: 'A tax deposit reaches the expense register and no cash or bank one — the view gives it no account, so it can never be reconciled against a statement.' })
      toast(`Deposited ${fmtDate(depDate)}${depRef === '' ? '' : ` · ${depRef}`}`, 'ok')
      setDepositing(null)
      setDepRef('')
      setDepAccountId('')
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was changed.', 'error')
    } finally {
      setBusy(null)
    }
  }

  function openDeposit(id: string) {
    setDepositing(depositing === id ? null : id)
    setDepDate(today)
    setDepRef('')
  }

  return (
    <section className={cardCls}>
      {ack !== null && (
        <div className="mb-3">
          <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Held back from payments</h2>
        <span className="font-mono text-[10px] text-stone-400">withholdings</span>
      </div>

      {owing > 0 && (
        <div className="mt-2">
          <Honesty
            verdict="held, not yet paid across"
            meter={{ filled: deposited, total: rows.length, unit: 'deposited' }}
          >
            {owing} {owing === 1 ? 'amount has' : 'amounts have'} been withheld and not yet marked
            deposited. Money held back stopped being this restaurant&apos;s the moment it was kept —
            until it is paid across it is a debt being carried, never a saving.
          </Honesty>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="mt-1.5 text-sm text-stone-700">
          Nothing has been withheld, or nothing has been recorded — this is a log, and an empty log
          is where every restaurant starts. Record the first one when a payment goes out short.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-rule-soft">
          {ordered.map((r) => (
            <li key={r.id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-sm text-stone-900">{r.party}</span>
                <span className={`${moneyCls} shrink-0 text-sm font-semibold text-stone-900`}>
                  {formatMoneyString(r.amount)}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-stone-400">
                {fmtDate(r.wh_date)} · {kindLabel(r.entity_type)}
                {r.regime_code !== null && ` · ${r.regime_code}`} · held back from{' '}
                {formatMoneyString(r.base_amount)}
                {r.rate_pct !== null && ` — which worked out to ${r.rate_pct}%`}
              </p>
              {r.note !== null && <p className="mt-0.5 text-xs text-stone-500">{r.note}</p>}

              {r.deposited_on === null ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <HonestyPill>not deposited</HonestyPill>
                  <button
                    type="button"
                    onClick={() => openDeposit(r.id)}
                    className="rounded-lg border border-rule px-2.5 py-1 text-xs font-medium text-stone-600 hover:border-emerald-300 hover:text-emerald-800"
                  >
                    {depositing === r.id ? 'Cancel' : 'Mark deposited'}
                  </button>
                </div>
              ) : (
                <p className="mt-0.5 text-[11px] text-emerald-800">
                  deposited {fmtDate(r.deposited_on)}
                  {r.challan_ref !== null && ` · ${r.challan_ref}`}
                </p>
              )}

              {depositing === r.id && (
                <div className="mt-1.5 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
                    <input
                      type="date"
                      value={depDate}
                      onChange={(e) => setDepDate(e.target.value)}
                      aria-label="Deposited on"
                      className={inputCls}
                    />
                    <input
                      value={depRef}
                      onChange={(e) => setDepRef(e.target.value)}
                      maxLength={120}
                      aria-label="Reference"
                      placeholder="reference on the receipt (optional)"
                      className={inputCls}
                    />
                  </div>
                  <AccountPicker
                    accounts={accounts}
                    value={depAccountId}
                    onChange={setDepAccountId}
                    label="Paid from"
                  />
                  <button
                    type="button"
                    disabled={busy !== null || depDate === '' || depAccountId === ''}
                    onClick={() => void deposit(r.id)}
                    className={`${btnCls} px-3 py-2 text-sm`}
                  >
                    {busy === r.id ? '…' : 'Deposited'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* The period control above does not reach this list, and saying so beats
          a silent mismatch. Filtering it would hide exactly the rows that
          matter: an old withholding nobody has paid across. */}
      {rows.length > 0 && (
        <p className="mt-2 text-xs text-stone-500">
          The whole log, newest first — not the period chosen above. Money held back and not yet
          paid across is owed whichever month it was kept in.
          {rows.length === 100 && ' Only the hundred most recent are listed.'}
        </p>
      )}

      {adding ? (
        <div className="mt-3 space-y-3 border-t border-rule pt-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>What the payment was</span>
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                className={selectCls}
              >
                {PAYMENT_KINDS.map((k) => (
                  <option key={k.v} value={k.v}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className={fieldLabelCls}>Who it was withheld from</span>
            <input
              value={party}
              onChange={(e) => setParty(e.target.value)}
              maxLength={120}
              placeholder="the name on the bill or the payment"
              className={inputCls}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Amount it was taken from</span>
              <input
                inputMode="decimal"
                value={baseAmount}
                onChange={(e) => setBaseAmount(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Amount withheld</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </label>
          </div>

          <label className="block">
            <span className={fieldLabelCls}>
              Code your revenue authority uses (optional)
            </span>
            <input
              value={regimeCode}
              onChange={(e) => setRegimeCode(e.target.value)}
              maxLength={40}
              placeholder="as it appears on your paperwork"
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-stone-500">
              Free text, copied down as written — 194C, PAYG, 1099 or nothing at all. The app does
              not check it, because it has no business knowing which authority you file with.
            </span>
          </label>

          <label className="block">
            <span className={fieldLabelCls}>Note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder="anything the next person should know"
              className={inputCls}
            />
          </label>

          <p className="text-xs text-stone-500">
            No rate is asked for. You enter what was paid and what was kept back; the rate is
            whatever those two figures come to, and it is worked out afterwards for reading. A
            field asking which rate applies would be this app giving filing advice, and the rates,
            thresholds and codes differ in every country it might be used in.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canSave || busy !== null}
              onClick={() => void save()}
              className={btnCls}
            >
              {busy === 'save' ? 'Recording…' : 'Record it'}
            </button>
            <button type="button" onClick={() => setAdding(false)} className={btnGhostCls}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`${btnCls} mt-3`}>
          Record a withholding
        </button>
      )}
    </section>
  )
}
