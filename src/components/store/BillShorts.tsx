'use client'

// The per-line "short?" affordance, on the bill the receiver is looking at.
//
// This is where a short is actually noticed — the driver leaves, the bill
// says 10 and the crate holds 8. Asking for it anywhere else means asking
// somebody to remember it later, and they do not. The quantity in the line
// above stays WHAT ARRIVED; this records what was billed and did not.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveShort } from '@/server/shorts-actions'
import { toast } from '@/components/Toasts'
import { formatMoneyString } from '@/lib/money'
import {
  SHORT_KINDS,
  SHORT_KIND_HELP,
  SHORT_KIND_LABELS,
  SHORT_SETTLEMENTS,
  SHORT_SETTLEMENT_LABELS,
  SHORT_SETTLEMENT_SHORT,
  type ValuedShort,
} from '@/components/store/shorts'
import {
  btnCls,
  btnGhostCls,
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  selectCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import { HonestyPill } from '@/components/Honesty'
import type { ShortKind, ShortSettlement } from '@/lib/types'

export type ShortableLine = {
  id: string
  item_code: string
  item_name: string
  purchase_unit: string
  qty: string
  rate: string
}

const BLANK = { qtyShort: '', kind: '' as ShortKind | '', settlement: 'open' as ShortSettlement, creditNoteRef: '', note: '' }

export default function BillShorts({
  lines,
  shorts,
  locked,
}: {
  lines: ShortableLine[]
  shorts: ValuedShort[]
  /** why this bill cannot take a short, if it cannot — voided, or a reversal */
  locked: string | null
}) {
  const [openLine, setOpenLine] = useState<string | null>(null)
  const [form, setForm] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function start(lineId: string) {
    setForm(BLANK)
    setError(null)
    setOpenLine(lineId)
  }

  async function submit(lineId: string) {
    if (form.kind === '') {
      setError('Pick what happened — short, damaged or rejected')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await saveShort({
        purchaseLineId: lineId,
        qtyShort: form.qtyShort,
        kind: form.kind,
        settlement: form.settlement,
        creditNoteRef: form.creditNoteRef,
        note: form.note,
      })
      if (res.ok) {
        toast('Short recorded against this line', 'ok')
        setOpenLine(null)
        setForm(BLANK)
        router.refresh()
      } else {
        setError(res.error)
        toast(res.error, 'error')
      }
    } catch {
      setError('Could not reach the server — nothing was recorded.')
    } finally {
      setBusy(false)
    }
  }

  const byLine = new Map<string, ValuedShort[]>()
  for (const s of shorts) byLine.set(s.purchase_line_id, [...(byLine.get(s.purchase_line_id) ?? []), s])

  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={sectionHeadCls}>Short, damaged or rejected</h3>
        <span className="font-mono text-[10px] text-stone-400">purchase_line_shorts</span>
      </div>
      <p className="mt-1.5 text-sm text-stone-600">
        The quantities above are what ARRIVED, and they stay that way — stock and costs are already right. What the
        vendor billed and did not deliver is recorded here, beside the line.
      </p>

      {locked !== null && <p className="mt-2 text-sm text-stone-500">{locked}</p>}

      <div className="mt-3 overflow-x-auto">
        <table className={dataTableCls}>
          <thead>
            <tr>
              <th className={thCls}>Item</th>
              <th className={thCls}>Code</th>
              <th className={thNumCls}>Arrived</th>
              <th className={thNumCls}>Rate</th>
              <th className={thNumCls}>Short</th>
              <th className={thCls}>Stands</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const rows = byLine.get(l.id) ?? []
              return [
                <tr key={l.id} className={trCls}>
                  <td className={tdCls}>{l.item_name}</td>
                  <td className={tdCodeCls}>{l.item_code}</td>
                  <td className={tdNumCls}>
                    {l.qty} <span className="text-stone-400">{l.purchase_unit}</span>
                  </td>
                  <td className={`${tdNumCls} text-stone-500`}>{formatMoneyString(l.rate)}</td>
                  <td className={`${tdNumCls} text-stone-400`}>{rows.length === 0 ? '—' : ''}</td>
                  <td className={`${tdCls} text-right`}>
                    {locked === null && openLine !== l.id && (
                      <button
                        type="button"
                        onClick={() => start(l.id)}
                        className="rounded-lg border border-rule px-2.5 py-1 text-[13px] font-medium text-stone-600 hover:border-stone-400 hover:bg-stone-50"
                      >
                        Short?
                      </button>
                    )}
                  </td>
                </tr>,

                ...rows.map((s) => (
                  <tr key={s.id} className={trCls}>
                    <td className={`${tdCls} pl-6 text-[13px] text-stone-500`}>
                      ↳ {SHORT_KIND_LABELS[s.kind]}
                      {s.credit_note_ref !== null && <> · {s.credit_note_ref}</>}
                      {s.note !== null && <> · {s.note}</>}
                    </td>
                    <td className={tdCls} />
                    <td className={tdCls} />
                    <td className={tdCls} />
                    <td className={`${tdNumCls} font-semibold text-red-700`}>
                      {s.qty_short} <span className="font-normal text-stone-400">{s.purchase_unit}</span> ·{' '}
                      {formatMoneyString(s.short_value)}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      {s.settlement === 'open' ? (
                        <HonestyPill level="alarm">Open</HonestyPill>
                      ) : (
                        <span className="text-[13px] text-stone-500">{SHORT_SETTLEMENT_SHORT[s.settlement]}</span>
                      )}
                    </td>
                  </tr>
                )),

                openLine === l.id ? (
                  <tr key={`${l.id}-form`}>
                    <td colSpan={6} className="border-b border-rule-soft px-3 py-3">
                      <p className="text-sm text-stone-600">
                        {l.qty} {l.purchase_unit} of <b>{l.item_name}</b> arrived. How much more was on the bill?
                      </p>
                      <div className="mt-2 flex flex-wrap items-end gap-3">
                        <div>
                          <label className={fieldLabelCls} htmlFor={`qty-${l.id}`}>
                            Short ({l.purchase_unit})
                          </label>
                          <input
                            id={`qty-${l.id}`}
                            inputMode="decimal"
                            autoComplete="off"
                            value={form.qtyShort}
                            onChange={(e) => setForm((f) => ({ ...f, qtyShort: e.target.value }))}
                            className={`${numCls} w-28`}
                          />
                        </div>
                        <div className="w-48">
                          {/* starts EMPTY: what happened is a judgement, and a
                              question that answers itself is not a question */}
                          <label className={fieldLabelCls} htmlFor={`kind-${l.id}`}>
                            What happened
                          </label>
                          <select
                            id={`kind-${l.id}`}
                            value={form.kind}
                            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ShortKind }))}
                            className={selectCls}
                          >
                            <option value="">Pick one</option>
                            {SHORT_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {SHORT_KIND_LABELS[k]} — {SHORT_KIND_HELP[k]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="w-56">
                          {/* 'open' is not a default standing in for an answer:
                              at the moment of receipt it is what is true */}
                          <label className={fieldLabelCls} htmlFor={`settle-${l.id}`}>
                            Where it stands
                          </label>
                          <select
                            id={`settle-${l.id}`}
                            value={form.settlement}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, settlement: e.target.value as ShortSettlement }))
                            }
                            className={selectCls}
                          >
                            {SHORT_SETTLEMENTS.map((s) => (
                              <option key={s} value={s}>
                                {SHORT_SETTLEMENT_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        </div>
                        {form.settlement === 'credit_note' && (
                          <div className="w-44">
                            <label className={fieldLabelCls} htmlFor={`cn-${l.id}`}>
                              Credit note no.
                            </label>
                            <input
                              id={`cn-${l.id}`}
                              autoComplete="off"
                              value={form.creditNoteRef}
                              onChange={(e) => setForm((f) => ({ ...f, creditNoteRef: e.target.value }))}
                              className={inputCls}
                            />
                          </div>
                        )}
                        <div className="min-w-[12rem] flex-1">
                          <label className={fieldLabelCls} htmlFor={`note-${l.id}`}>
                            Note (optional)
                          </label>
                          <input
                            id={`note-${l.id}`}
                            autoComplete="off"
                            value={form.note}
                            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                            className={inputCls}
                          />
                        </div>
                      </div>
                      {error !== null && (
                        <p role="alert" className="mt-2 text-sm text-red-800">
                          {error}
                        </p>
                      )}
                      <div className="mt-3 flex items-center gap-2">
                        <button type="button" disabled={busy} onClick={() => submit(l.id)} className={btnCls}>
                          {busy ? 'Recording…' : 'Record the short'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setOpenLine(null)}
                          className={btnGhostCls}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ]
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
