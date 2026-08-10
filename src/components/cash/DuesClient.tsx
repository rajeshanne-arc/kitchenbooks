'use client'

// Dues: credit given (positive) and money received back (negative), one
// append-only ledger per party. The party is a picker-from-history plus
// add-new — “Ramu” vs “Ramu anna” would never net, so pick, don't retype.
// dues_outstanding nets on the normalized name.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DueOutstandingRow, DueRow, SaveDueResult } from '@/lib/types'
import { saveDue, voidDue } from '@/server/cashier-actions'
import { decimalStringToPaise, formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function DuesClient({
  parties,
  rows,
  outstanding,
}: {
  parties: string[]
  rows: DueRow[]
  outstanding: DueOutstandingRow[]
}) {
  const router = useRouter()
  const [date, setDate] = useState(todayLocal)
  const [party, setParty] = useState('')
  const [direction, setDirection] = useState<'given' | 'received'>('given')
  const [amount, setAmount] = useState('')
  const [againstWhat, setAgainstWhat] = useState('')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveDueResult, { ok: true }> | null>(null)

  const canSave =
    !saving && party.trim() !== '' && parseMoney(amount.trim()) !== null && Number(amount.trim()) > 0

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveDue({
        date,
        party: party.trim(),
        amount: amount.trim(),
        direction,
        againstWhat: againstWhat.trim(),
        ref: ref.trim(),
        note: note.trim(),
      })
      if (res.ok) {
        setSaved(res)
        setAmount('')
        setAgainstWhat('')
        setRef('')
        setNote('')
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  async function onVoid(id: string) {
    if (busy !== null) return
    setBusy(id)
    try {
      const res = await voidDue(id)
      if (res.ok) {
        toast('Due entry voided')
        router.refresh()
      } else {
        toast(res.error, 'error')
      }
    } catch {
      toast('Could not reach the server — nothing was voided.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Record credit / repayment</h2>
        {saved !== null && (
          <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-stone-800">
            {saved.due.party}: {formatMoneyString(saved.due.amount)} recorded — their balance now{' '}
            <span className="font-semibold tabular-nums">
              {formatMoneyString(
                saved.outstanding.find((o) => o.party.toLowerCase().trim() === saved.due.party.toLowerCase().trim())
                  ?.balance ?? '0',
              )}
            </span>
            <span className="ml-1 text-xs text-stone-500">· read from dues_outstanding</span>
          </p>
        )}
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Party</span>
              <input list="kb-due-parties" value={party} onChange={(e) => setParty(e.target.value)} placeholder="pick or add" className={inputCls} maxLength={120} />
              <datalist id="kb-due-parties">
                {parties.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="flex items-center gap-2">
            {(
              [
                ['given', 'Credit given'],
                ['received', 'Received back'],
              ] as const
            ).map(([d, lbl]) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                  direction === d
                    ? d === 'given'
                      ? 'border-amber-600 bg-amber-600 text-white'
                      : 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400'
                }`}
              >
                {lbl}
              </button>
            ))}
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${numCls} w-32 text-right`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Against what</span>
              <input value={againstWhat} onChange={(e) => setAgainstWhat(e.target.value)} placeholder="optional" className={inputCls} maxLength={200} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Reference</span>
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="bill no, optional" className={inputCls} maxLength={60} />
            </label>
          </div>
          <label className="block">
            <span className={fieldLabelCls}>Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
          </label>
        </div>
        {error && (
          <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {saving ? 'Saving…' : direction === 'given' ? 'Record credit given' : 'Record received back'}
        </button>
      </section>

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Outstanding</h2>
          <span className="text-xs text-stone-400">dues_outstanding · netted per party</span>
        </div>
        {outstanding.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nobody owes and nobody is owed. Clean slate.</p>
        ) : (
          <ul className="mt-1 divide-y divide-stone-100">
            {outstanding.map((o) => {
              const bal = decimalStringToPaise(o.balance)
              return (
                <li key={o.party} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-[15px] text-stone-900">{o.party}</span>
                  <span className={`tabular-nums text-sm font-semibold ${bal > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {formatMoneyString(o.balance)} {bal > 0 ? 'to collect' : 'to give back'}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Recent entries</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-stone-100">
            {rows.map((r) => {
              const amt = decimalStringToPaise(r.amount)
              return (
                <li key={r.id} className={`flex items-center justify-between gap-3 py-2.5 ${r.is_reversal ? 'opacity-60' : ''}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-stone-900">
                      {fmtDate(r.due_date)} · {r.party}
                      {r.against_what !== null && ` · ${r.against_what}`}
                      {r.is_reversal && ' · reversal'}
                      {r.is_voided && (
                        <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                          voided
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {amt > 0 ? 'credit given' : 'received back'}
                      {r.entered_by !== null && ` · by ${r.entered_by}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`tabular-nums text-sm font-semibold ${amt > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {formatMoneyString(r.amount)}
                    </span>
                    {!r.is_reversal && !r.is_voided && (
                      <button
                        type="button"
                        onClick={() => void onVoid(r.id)}
                        disabled={busy !== null}
                        className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-500 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                      >
                        {busy === r.id ? '…' : 'Void'}
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
