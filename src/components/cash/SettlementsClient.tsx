'use client'

// Partner settlements: what the aggregator period grossed, what they kept,
// what landed in the bank. The partner comes from the partners MASTER —
// not list_options, which could only ever hold a name; the master carries
// agreed_commission_pct, and that is what the gap card compares against.
//
// THE GAP IS THE POINT. "We billed" is our own books; "they claim" is their
// statement. Either may be blank — a settlement filed before the statement
// arrives has one side only — and the dashboard counts those as uncompared
// rather than reading a missing side as zero. Deductions are itemised lines,
// because "other deductions: ₹4,000" is where the argument starts.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MoneyAccount, Partner, PartnerSummaryRow, SaveSettlementResult, SettlementRow } from '@/lib/types'
import { saveSettlement, voidSettlement } from '@/server/cashier-actions'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, selectCls, sectionHeadCls } from '@/components/ui'
import AccountPicker from '@/components/accounts/AccountPicker'
import { toast } from '@/components/Toasts'
import SaveAck from '@/components/SaveAck'
import { useBusinessToday } from '@/components/BusinessDay'

const moneyClean = (s: string) => s.replace(/[^\d.]/g, '')

type Deduction = { key: number; type: string; amount: string; note: string }

export default function SettlementsClient({
  partners,
  deductionTypes,
  rows,
  summaries,
  accounts,
}: {
  partners: Partner[]
  deductionTypes: string[]
  rows: SettlementRow[]
  summaries: PartnerSummaryRow[]
  accounts: MoneyAccount[]
}) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const [partner, setPartner] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState(businessToday)
  const [gross, setGross] = useState('')
  const [commission, setCommission] = useState('')
  const [deductions, setDeductions] = useState('')
  const [received, setReceived] = useState('')
  const [receivedDate, setReceivedDate] = useState('')
  const [accountId, setAccountId] = useState('')
  const [note, setNote] = useState('')
  const [reference, setReference] = useState('')
  const [billed, setBilled] = useState('')
  const [claimed, setClaimed] = useState('')
  const [lines, setLines] = useState<Deduction[]>([])
  const [nextKey, setNextKey] = useState(1)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveSettlementResult, { ok: true }> | null>(null)
  /** the gap as it was FILED. `settlements.gap` is a GENERATED column on the
   *  view, not on the row the action returns, so this is captured from the two
   *  sides that were typed — and left null when only one of them was, because
   *  an unfilled side is uncompared and not a zero difference. */
  const [savedGap, setSavedGap] = useState<string | null>(null)

  const canSave =
    !saving &&
    partner !== '' &&
    periodStart !== '' &&
    periodEnd !== '' &&
    parseMoney(gross.trim()) !== null &&
    // the same conditional the server applies: money that arrived has to say where
    (received.trim() === '' || accountId !== '')

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
        reference: reference.trim(),
        billedByUs: billed.trim(),
        claimedByThem: claimed.trim(),
        accountId,
        deductions: lines
          .filter((l) => l.type !== '' && parseMoney(l.amount.trim()) !== null)
          .map((l) => ({ type: l.type, amount: l.amount.trim(), note: l.note.trim() })),
      })
      if (res.ok) {
        setSaved(res)
        setSavedGap(
          billed.trim() !== '' && claimed.trim() !== ''
            ? (Number(billed) - Number(claimed)).toFixed(2)
            : null,
        )
        setGross('')
        setCommission('')
        setDeductions('')
        setReceived('')
        setReceivedDate('')
        setAccountId('')
        setNote('')
        setReference('')
        setBilled('')
        setClaimed('')
        setLines([])
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
          <div className="mt-2">
            <SaveAck
              onDismiss={() => setSaved(null)}
              headline={
                <>
                  {saved.settlement.partner} — gross{' '}
                  <span className="tabular-nums">{formatMoneyString(saved.settlement.gross_sales ?? '0')}</span>
                  {savedGap !== null && (
                    <>
                      , gap <span className="tabular-nums">{formatMoneyString(savedGap)}</span>
                    </>
                  )}
                </>
              }
              sub={`${fmtDate(saved.settlement.period_start)} – ${fmtDate(saved.settlement.period_end)}${
                saved.settlement.commission !== null && Number(saved.settlement.gross_sales ?? 0) > 0
                  ? ` · they kept ${(
                      (Number(saved.settlement.commission) / Number(saved.settlement.gross_sales)) *
                      100
                    ).toFixed(1)}% against the agreed rate on their partner card`
                  : ''
              }`}
              missing={
                savedGap === null
                  ? [
                      {
                        verdict: 'one-sided',
                        text: 'Only one of billed-by-us and claimed-by-them is filled, so the gap cannot be worked out. This settlement counts as uncompared on the dashboard rather than as agreeing — an unfilled side is not a zero difference.',
                      },
                    ]
                  : undefined
              }
            />
          </div>
        )}
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Partner</span>
              <select value={partner} onChange={(e) => setPartner(e.target.value)} className={selectCls}>
                <option value="">—</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                    {p.agreed_commission_pct !== null && ` — ${p.agreed_commission_pct}% agreed`}
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
          {/* THE GAP — our books against their statement */}
          <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-3">
            <h3 className={sectionHeadCls}>The two sides</h3>
            <p className="mt-0.5 text-xs text-stone-600">
              Leave a side blank if it has not arrived yet — the dashboard counts that as not-yet-compared, not
              as zero.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="block sm:col-span-2">
                <span className={fieldLabelCls}>Their reference</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="statement or UTR number"
                  className={`${numCls} w-full font-mono`}
                  maxLength={80}
                />
                <span className="mt-1 block text-xs text-stone-500">
                  What you quote back at them when the gap is disputed.
                </span>
              </label>
              <label className="block">
                <span className={fieldLabelCls}>We billed (₹)</span>
                <input
                  inputMode="decimal"
                  placeholder="our books"
                  value={billed}
                  onChange={(e) => setBilled(moneyClean(e.target.value))}
                  className={`${numCls} w-full text-right font-mono tabular-nums`}
                />
              </label>
              <label className="block">
                <span className={fieldLabelCls}>They claim (₹)</span>
                <input
                  inputMode="decimal"
                  placeholder="their statement"
                  value={claimed}
                  onChange={(e) => setClaimed(moneyClean(e.target.value))}
                  className={`${numCls} w-full text-right font-mono tabular-nums`}
                />
              </label>
            </div>
            {billed.trim() !== '' && claimed.trim() !== '' && (
              <p className="mt-2 text-sm">
                Gap:{' '}
                <span
                  className={`font-mono font-bold tabular-nums ${
                    Number(billed) - Number(claimed) === 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {formatMoneyString((Number(billed) - Number(claimed)).toFixed(2))}
                </span>
                <span className="ml-1 text-xs text-stone-500">
                  — the database recomputes this on save; this is only the preview
                </span>
              </p>
            )}
          </div>

          {/* itemised deductions */}
          <div className="rounded-xl border border-rule bg-stone-50 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className={sectionHeadCls}>Deductions, itemised</h3>
              <span className="text-xs text-stone-500">optional — but this is where the argument starts</span>
            </div>
            {lines.length > 0 && (
              <div className="mt-2 space-y-2">
                {lines.map((l, i) => (
                  <div key={l.key} className="grid grid-cols-[1fr_7rem_1fr_2rem] gap-2">
                    <select
                      value={l.type}
                      aria-label={`Deduction type, line ${i + 1}`}
                      onChange={(e) =>
                        setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, type: e.target.value } : x)))
                      }
                      className={selectCls}
                    >
                      <option value="">—</option>
                      {deductionTypes.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label={`Deduction amount, line ${i + 1}`}
                      value={l.amount}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x) => (x.key === l.key ? { ...x, amount: moneyClean(e.target.value) } : x)),
                        )
                      }
                      className={`${numCls} w-full text-right font-mono tabular-nums`}
                    />
                    <input
                      placeholder="note"
                      aria-label={`Deduction note, line ${i + 1}`}
                      value={l.note}
                      onChange={(e) =>
                        setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, note: e.target.value } : x)))
                      }
                      className={`${numCls} w-full`}
                      maxLength={200}
                    />
                    <button
                      type="button"
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      aria-label={`Remove deduction ${i + 1}`}
                      className="rounded-md text-stone-300 hover:bg-stone-100 hover:text-stone-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {deductionTypes.length === 0 ? (
              <p className="mt-2 text-xs text-amber-900">
                No deduction types are set up — add them in Setup → Lists.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setLines((ls) => [...ls, { key: nextKey, type: '', amount: '', note: '' }])
                  setNextKey((k) => k + 1)
                }}
                className="mt-2 w-full rounded-lg border border-dashed border-stone-300 py-2 text-xs font-medium text-stone-500 hover:border-emerald-400 hover:text-emerald-700"
              >
                ＋ Add a deduction
              </button>
            )}
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
            {/* beside the receipt, not after the note — a settlement filed before
                the money arrives has no movement to place, so the server demands
                this only once an amount was received, and the prompt follows it */}
            <AccountPicker
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
              label="Receipt landed in"
              required={received.trim() !== ''}
            />
            <label className="col-span-3 block">
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
