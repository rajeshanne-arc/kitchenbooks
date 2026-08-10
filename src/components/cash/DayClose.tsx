'use client'

// The cashier's close. The ladder comes from the server (opening resolved by
// the chain law, live POS cash / other income / vouchers); the cashier types
// ONLY extra-in, handed-over (+ to whom), counted cash and the bank block.
// The preview does its arithmetic in paise; the REVEAL reads day_close_ladder
// back from the database. Difference is red whenever it is not zero.

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ClosePrefill, CloseDayResult, DayCloseLadderRow } from '@/lib/types'
import { closeDay, setFirstOpening } from '@/server/cash-actions'
import { buildCloseText, whatsappUrl } from '@/lib/share'
import { decimalStringToPaise, formatPaise, formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls } from '@/components/ui'

function Rung({ label, value, sign, strong }: { label: string; value: string; sign?: '+' | '−'; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className={`text-sm ${strong ? 'font-semibold text-stone-900' : 'text-stone-600'}`}>
        {sign !== undefined && <span className="mr-1 inline-block w-3 text-stone-400">{sign}</span>}
        {label}
      </span>
      <span className={`tabular-nums ${strong ? 'text-[15px] font-semibold text-stone-900' : 'text-sm text-stone-700'}`}>
        {value}
      </span>
    </div>
  )
}

function SetOpening({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await setFirstOpening({ amount: amount.trim() })
      if (res.ok) onDone()
      else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">Set opening cash — once</p>
      <p className="mt-0.5 text-xs text-amber-800">
        The float in the drawer before the first close ever. After that, every opening comes from the previous day’s
        counted cash; this button refuses.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          className={`${numCls} w-32`}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || parseMoney(amount.trim()) === null}
          className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:bg-stone-300"
        >
          {saving ? 'Saving…' : 'Set opening'}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-red-700">{error}</p>}
    </div>
  )
}

export default function DayClose({
  defaultDate,
  initialPrefill,
  restaurantName,
}: {
  defaultDate: string
  initialPrefill: ClosePrefill
  restaurantName: string
}) {
  const router = useRouter()
  const [date, setDate] = useState(defaultDate)
  const [prefill, setPrefill] = useState<ClosePrefill | null>(initialPrefill)
  const [extraIn, setExtraIn] = useState('')
  const [handedOver, setHandedOver] = useState('')
  const [handedTo, setHandedTo] = useState('')
  const [counted, setCounted] = useState('')
  const [bank, setBank] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<DayCloseLadderRow | null>(null)
  const reqSeq = useRef(0)

  async function loadPrefill(d: string) {
    const seq = ++reqSeq.current
    setPrefill(null)
    try {
      const res = await fetch(`/api/cash/prefill?date=${d}`, { cache: 'no-store' })
      const data = (await res.json()) as ClosePrefill
      if (seq === reqSeq.current) setPrefill(data)
    } catch {
      if (seq === reqSeq.current) {
        setPrefill({ ok: false, blocked: 'no_opening', missingDate: null, anyCloses: false, error: 'Could not load the ladder — retry.' })
      }
    }
  }

  function onDateChange(d: string) {
    setDate(d)
    if (d === defaultDate) {
      reqSeq.current += 1
      setPrefill(initialPrefill)
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      void loadPrefill(d)
    } else {
      setPrefill(null)
    }
  }

  const money = (s: string) => (s.trim() === '' ? 0 : (parseMoney(s.trim()) ?? NaN))
  const preview = (() => {
    if (prefill === null || !prefill.ok) return null
    const opening = decimalStringToPaise(prefill.opening)
    const pos = decimalStringToPaise(prefill.posCash)
    const income = decimalStringToPaise(prefill.otherIncome)
    const vouchers = decimalStringToPaise(prefill.cashierVouchers)
    const extra = money(extraIn)
    const handed = money(handedOver)
    if (Number.isNaN(extra) || Number.isNaN(handed)) return null
    const expected = opening + pos + income + extra - vouchers - handed
    const countedP = counted.trim() === '' ? null : parseMoney(counted.trim())
    return { expected, difference: countedP === null ? null : countedP - expected }
  })()

  const canSave =
    !saving &&
    prefill !== null &&
    prefill.ok &&
    parseMoney(counted.trim()) !== null &&
    (money(handedOver) === 0 || handedTo.trim() !== '') &&
    !Number.isNaN(money(extraIn)) &&
    !Number.isNaN(money(handedOver))

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res: CloseDayResult = await closeDay({
        date,
        extraCashIn: extraIn.trim(),
        handedOver: handedOver.trim(),
        handedTo: handedTo.trim(),
        cashCounted: counted.trim(),
        bankSettled: bank.trim(),
        note: note.trim(),
      })
      if (res.ok) {
        setSaved(res.ladder)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the close was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  function startAnother() {
    setSaved(null)
    setExtraIn('')
    setHandedOver('')
    setHandedTo('')
    setCounted('')
    setBank('')
    setNote('')
    setError(null)
    void loadPrefill(date)
  }

  if (saved !== null) {
    const diff = decimalStringToPaise(saved.difference)
    return (
      <section className={cardCls}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Closed — {fmtDate(saved.close_date)}
          </h2>
          {saved.filings > 1 && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              corrected ×{saved.filings - 1} — latest wins
            </span>
          )}
        </div>
        <div className="mt-2 divide-y divide-stone-100">
          <Rung label="Opening" value={formatMoneyString(saved.opening_cash)} />
          <Rung label="POS cash sales" value={formatMoneyString(saved.pos_cash)} sign="+" />
          <Rung label="Other income" value={formatMoneyString(saved.other_income)} sign="+" />
          <Rung label="Extra cash in" value={formatMoneyString(saved.extra_cash_in)} sign="+" />
          <Rung label="Cashier vouchers" value={formatMoneyString(saved.cashier_vouchers)} sign="−" />
          <Rung
            label={`Handed over${saved.handed_to !== null ? ` to ${saved.handed_to}` : ''}`}
            value={formatMoneyString(saved.handed_over)}
            sign="−"
          />
          <Rung label="Expected in drawer" value={formatMoneyString(saved.expected_cash)} strong />
          <Rung label="Counted" value={formatMoneyString(saved.cash_counted)} strong />
        </div>
        <div
          className={`mt-3 rounded-xl border p-3 text-center ${
            diff === 0 ? 'border-emerald-200 bg-emerald-50/60' : 'border-red-300 bg-red-50'
          }`}
        >
          <span className={`text-2xl font-bold tabular-nums ${diff === 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {formatMoneyString(saved.difference)}
          </span>
          <p className={`mt-0.5 text-xs font-medium ${diff === 0 ? 'text-emerald-800' : 'text-red-800'}`}>
            {diff === 0 ? 'drawer squares exactly' : 'difference — the drawer does not square; it belongs to this day'}
          </p>
        </div>
        {saved.bank_settled !== null && (
          <p className="mt-2 text-sm text-stone-600">Bank settled: {formatMoneyString(saved.bank_settled)}</p>
        )}
        <p className="mt-1 text-xs text-stone-400">read back from day_close_ladder</p>
        <a
          href={whatsappUrl(buildCloseText(restaurantName, saved))}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block w-full rounded-xl bg-[#25D366] py-3 text-center text-[15px] font-semibold text-white shadow-sm hover:brightness-95"
        >
          Share on WhatsApp
        </a>
        <button
          type="button"
          onClick={startAnother}
          className="mt-2 w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          Close another day
        </button>
      </section>
    )
  }

  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">Day close</h2>
        <span className="text-xs text-stone-400">one day at a time · day_close_ladder</span>
      </div>

      <label className="mt-3 block">
        <span className={fieldLabelCls}>Date</span>
        <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} className={numCls} />
      </label>

      {prefill === null && <p className="mt-3 text-sm text-stone-400">Loading the ladder…</p>}

      {prefill !== null && !prefill.ok && (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {prefill.error}
          {prefill.blocked === 'no_opening' && !prefill.anyCloses && (
            <SetOpening onDone={() => void loadPrefill(date)} />
          )}
        </div>
      )}

      {prefill !== null && prefill.ok && (
        <>
          {prefill.priorFilings > 0 && (
            <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              This day is already closed (filed {prefill.priorFilings}×). Saving again records a corrected close — the
              new one wins, the old one stays visible.
            </p>
          )}
          <div className="mt-3 divide-y divide-stone-100">
            <Rung
              label={`Opening (${prefill.openingSource})`}
              value={formatMoneyString(prefill.opening)}
            />
            <Rung label="POS cash sales" value={formatMoneyString(prefill.posCash)} sign="+" />
            <Rung label="Other income" value={formatMoneyString(prefill.otherIncome)} sign="+" />
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-sm text-stone-600">
                <span className="mr-1 inline-block w-3 text-stone-400">+</span>Extra cash in
              </span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={extraIn}
                onChange={(e) => setExtraIn(e.target.value.replace(/[^\d.]/g, ''))}
                className={`${numCls} w-28 text-right`}
              />
            </div>
            <Rung label="Cashier vouchers" value={formatMoneyString(prefill.cashierVouchers)} sign="−" />
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-sm text-stone-600">
                <span className="mr-1 inline-block w-3 text-stone-400">−</span>Handed over
              </span>
              <div className="flex items-center gap-2">
                <input
                  placeholder="to whom"
                  value={handedTo}
                  onChange={(e) => setHandedTo(e.target.value)}
                  className={`${numCls} w-28`}
                />
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={handedOver}
                  onChange={(e) => setHandedOver(e.target.value.replace(/[^\d.]/g, ''))}
                  className={`${numCls} w-28 text-right`}
                />
              </div>
            </div>
            {preview !== null && (
              <Rung label="Expected in drawer" value={formatPaise(preview.expected)} strong />
            )}
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-sm font-semibold text-stone-900">Counted cash</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={counted}
                onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ''))}
                className={`${numCls} w-32 text-right font-semibold`}
              />
            </div>
          </div>

          {preview !== null && preview.difference !== null && (
            <div
              className={`mt-2 flex items-center justify-between rounded-xl border px-3 py-2 ${
                preview.difference === 0 ? 'border-emerald-200 bg-emerald-50/60' : 'border-red-300 bg-red-50'
              }`}
            >
              <span
                className={`text-sm font-medium ${preview.difference === 0 ? 'text-emerald-800' : 'text-red-800'}`}
              >
                Difference
              </span>
              <span
                className={`text-lg font-bold tabular-nums ${
                  preview.difference === 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatPaise(preview.difference)}
              </span>
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Bank settled (UPI/card, optional)</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={bank}
                onChange={(e) => setBank(e.target.value.replace(/[^\d.]/g, ''))}
                className={`${numCls} w-full text-right`}
              />
            </label>
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
            className="mt-3 w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {saving ? 'Saving…' : prefill.priorFilings > 0 ? 'Save corrected close' : 'Close the day'}
          </button>
        </>
      )}
    </section>
  )
}
