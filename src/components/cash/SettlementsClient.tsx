'use client'

// Partner settlements: what the aggregator period grossed, what they kept,
// what landed in the bank. Partner comes from the list (LAW 2); the
// per-partner summary is server-computed. Corrections are negative twins.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PartnerSummaryRow, SaveSettlementResult, SettlementRow } from '@/lib/types'
import { saveSettlement, voidSettlement } from '@/server/cashier-actions'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, selectCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

const moneyClean = (s: string) => s.replace(/[^\d.]/g, '')

export default function SettlementsClient({
  partners,
  rows,
  summaries,
}: {
  partners: string[]
  rows: SettlementRow[]
  summaries: PartnerSummaryRow[]
}) {
  const router = useRouter()
  const [partner, setPartner] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState(todayLocal)
  const [gross, setGross] = useState('')
  const [commission, setCommission] = useState('')
  const [deductions, setDeductions] = useState('')
  const [received, setReceived] = useState('')
  const [receivedDate, setReceivedDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveSettlementResult, { ok: true }> | null>(null)

  const canSave =
    !saving &&
    partner !== '' &&
    periodStart !== '' &&
    periodEnd !== '' &&
    parseMoney(gross.trim()) !== null

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveSettlement({
        partner,
        periodStart,
        periodEnd,
        grossSales: gross.trim(),
        commission: commission.trim(),
        otherDeductions: deductions.trim(),
        amountReceived: received.trim(),
        receivedDate,
        note: note.trim(),
      })
      if (res.ok) {
        setSaved(res)
        setGross('')
        setCommission('')
        setDeductions('')
        setReceived('')
        setReceivedDate('')
        setNote('')
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the settlement was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  async function onVoid(id: string) {
    if (busy !== null) return
    setBusy(id)
    try {
      const res = await voidSettlement(id)
      if (res.ok) {
        toast('Settlement voided — the negative twin is on record')
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
        <h2 className={sectionHeadCls}>Record a settlement</h2>
        {saved !== null && (
          <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-stone-800">
            {saved.settlement.partner} · {fmtDate(saved.settlement.period_start)} –{' '}
            {fmtDate(saved.settlement.period_end)} recorded — gross{' '}
            <span className="font-semibold tabular-nums">{formatMoneyString(saved.settlement.gross_sales ?? '0')}</span>
          </p>
        )}
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Partner</span>
              <select value={partner} onChange={(e) => setPartner(e.target.value)} className={selectCls}>
                <option value="">—</option>
                {partners.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Period from</span>
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={`${numCls} w-full`} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>to</span>
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={`${numCls} w-full`} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Gross sales (₹)</span>
              <input inputMode="decimal" placeholder="0.00" value={gross} onChange={(e) => setGross(moneyClean(e.target.value))} className={`${numCls} w-full text-right`} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Commission (₹)</span>
              <input inputMode="decimal" placeholder="0.00" value={commission} onChange={(e) => setCommission(moneyClean(e.target.value))} className={`${numCls} w-full text-right`} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Other deductions (₹)</span>
              <input inputMode="decimal" placeholder="0.00" value={deductions} onChange={(e) => setDeductions(moneyClean(e.target.value))} className={`${numCls} w-full text-right`} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Received (₹)</span>
              <input inputMode="decimal" placeholder="0.00" value={received} onChange={(e) => setReceived(moneyClean(e.target.value))} className={`${numCls} w-full text-right`} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Received on</span>
              <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className={`${numCls} w-full`} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
            </label>
          </div>
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
          {saving ? 'Saving…' : 'Record settlement'}
        </button>
        <p className="mt-2 text-center text-xs text-stone-400">
          Line-by-line reconciliation against the aggregator&apos;s statement waits for a real statement.
        </p>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Per partner</h2>
        {summaries.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">No settlements yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-rule-soft">
            {summaries.map((s) => (
              <li key={s.partner} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-medium text-stone-900">
                    {s.partner} <span className="text-xs text-stone-400">×{s.settlements}</span>
                  </span>
                  <span className={`tabular-nums text-sm font-semibold ${Number(s.outstanding) > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {formatMoneyString(s.outstanding)} pending
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-stone-500">
                  gross {formatMoneyString(s.gross_sales)} · commission {formatMoneyString(s.commission)} · deductions{' '}
                  {formatMoneyString(s.other_deductions)} · received {formatMoneyString(s.amount_received)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Recent settlements</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nothing filed yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-rule-soft">
            {rows.map((r) => (
              <li key={r.id} className={`flex items-center justify-between gap-3 py-2.5 ${r.is_reversal ? 'opacity-60' : ''}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-stone-900">
                    {r.partner} · {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                    {r.is_reversal && ' · reversal'}
                    {r.is_voided && (
                      <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                        voided
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-stone-500">
                    received {r.amount_received !== null ? formatMoneyString(r.amount_received) : '—'}
                    {r.received_date !== null && ` on ${fmtDate(r.received_date)}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-sm font-semibold text-stone-900">
                    {r.gross_sales !== null ? formatMoneyString(r.gross_sales) : '—'}
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
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
