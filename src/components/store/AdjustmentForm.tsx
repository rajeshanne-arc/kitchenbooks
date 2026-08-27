'use client'

// A correction with no count behind it: opening stock, a unit error caught
// on the shelf, spoilage found in a corner.
//
// The direction is two buttons, not a minus sign. A signed quantity typed on
// a phone is a fat finger away from meaning the opposite of what was meant,
// and "onto the book" / "off the book" is the sentence the person is
// actually thinking. The form composes the sign; the server stores it.
//
// No rate field, deliberately: unit_cost is snapshotted server-side from
// item_costs, exactly as on an issue. The store never types a cost.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IssuableItemHit, SaveAdjustmentsResult } from '@/lib/types'
import { saveAdjustments } from '@/server/adjustment-actions'
import SaveAck from '@/components/SaveAck'
import { parseQty } from '@/lib/money'
import IssueItemPicker from '@/components/store/IssueItemPicker'
import {
  btnCls,
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  selectCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import { useBusinessToday } from '@/components/BusinessDay'
import BackdatedCost from '@/components/BackdatedCost'

const OTHER = '__other__'

type Line = { key: number; item: IssuableItemHit | null; direction: 'onto' | 'off'; qty: string }
const newLine = (key: number): Line => ({ key, item: null, direction: 'onto', qty: '' })

export default function AdjustmentForm({ reasons }: { reasons: string[] }) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const [date, setDate] = useState(businessToday)
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [picked, setPicked] = useState(reasons.length === 0 ? OTHER : '')
  const [typedReason, setTypedReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<Extract<SaveAdjustmentsResult, { ok: true }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reason = picked === OTHER ? typedReason.trim() : picked

  const patchLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [newLine(nextKey)] : ls.filter((l) => l.key !== key)))

  const filled = lines.filter((l) => l.item !== null || l.qty.trim() !== '')
  const lineOk = (l: Line) => {
    const q = parseQty(l.qty.trim())
    return l.item !== null && q !== null && q > 0
  }
  // The same item twice would tie on created_at inside one transaction, which
  // the count-acceptance arithmetic cannot order — the server refuses it, and
  // the form says so before the trip.
  const ids = filled.map((l) => l.item?.id).filter(Boolean)
  const duplicate = ids.length !== new Set(ids).size
  const canSave =
    !saving && filled.length > 0 && filled.every(lineOk) && reason !== '' && !duplicate

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveAdjustments({
        date,
        reason,
        note: note.trim(),
        lines: filled.map((l) => ({
          itemId: (l.item as IssuableItemHit).id,
          // signed: minus is a shortfall, and the direction toggle is what
          // composes the sign so nobody types a minus by hand
          qty: l.direction === 'off' ? `-${l.qty.trim()}` : l.qty.trim(),
        })),
      })
      if (res.ok) {
        setSaved(res)
        setLines([newLine(nextKey)])
        setNextKey((k) => k + 1)
        setNote('')
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was corrected. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {saved !== null && (
        <SaveAck
          onDismiss={() => setSaved(null)}
          headline={`Book corrected — ${saved.count} ${saved.count === 1 ? 'item' : 'items'}`}
          sub={`${saved.reason} · a correction is a DIFFERENCE, never a new total — two counts taken before either was accepted both measure against the same book`}
          missing={
            saved.stock.filter((x) => Number(x.on_hand_qty) < 0).length > 0
              ? [
                  {
                    level: 'alarm' as const,
                    verdict: 'still negative',
                    text: `${saved.stock
                      .filter((x) => Number(x.on_hand_qty) < 0)
                      .map((x) => `${x.name} is at ${x.on_hand_qty} ${x.purchase_unit}`)
                      .join(', ')} — the correction did not bring it back above zero, so a bill is still missing rather than the count being wrong.`,
                  },
                ]
              : undefined
          }
        >
          <ul className="divide-y divide-emerald-200/60 border-y border-emerald-200/60">
            {saved.stock.map((x) => (
              <li key={x.item_id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 truncate text-stone-900">{x.name}</span>
                <span
                  className={`shrink-0 font-semibold tabular-nums ${
                    Number(x.on_hand_qty) < 0 ? 'text-red-700' : 'text-stone-900'
                  }`}
                >
                  now {x.on_hand_qty} {x.purchase_unit}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-stone-500">read live from stock_on_hand</p>
        </SaveAck>
      )}
      <section className={cardCls}>
      <h2 className={sectionHeadCls}>Correct the book</h2>
      <p className="mt-1.5 text-sm text-stone-500">
        One item, one difference, one reason. The cost is taken from what the item has been costing — it is never
        typed here.
      </p>

      <div className="mt-3 space-y-3">
        <label className="block sm:w-44">
          <span className={fieldLabelCls}>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
        </label>
        <BackdatedCost date={date} what="today's weighted average cost for that item" />

        {/* THE REASON IS A HEADER FIELD, unlike the loss forms where it is per
            line. A batch of corrections is one EVENT — a stocktake, an opening
            balance, a found crate — and two reasons means two events, which is
            two saves. Two things in one bin really are lost for two reasons;
            two items corrected together really do share one. */}
        <label className="block">
          <span className={fieldLabelCls}>Reason — for all of these</span>
          <select value={picked} onChange={(e) => setPicked(e.target.value)} className={selectCls}>
            <option value="">—</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value={OTHER}>Something else…</option>
          </select>
        </label>

        <div className="overflow-x-auto">
          <table className={dataTableCls}>
            <thead>
              <tr>
                <th className={thCls}>Item</th>
                <th className={thCls}>Direction</th>
                <th className={thNumCls}>Difference</th>
                <th className={thCls}>Unit</th>
                <th className={thCls}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className={trCls}>
                  <td className={tdCls}>
                    <IssueItemPicker
                      value={l.item}
                      onPick={(hit) => patchLine(l.key, { item: hit })}
                      onClear={() => patchLine(l.key, { item: null })}
                    />
                  </td>
                  <td className={tdCls}>
                    {/* the shelf's own words, per line — a stocktake finds
                        surpluses and shortfalls in the same pass */}
                    <div className="flex gap-1" role="group" aria-label="Direction of the correction">
                      {(
                        [
                          { key: 'onto', short: 'Onto', sub: 'more' },
                          { key: 'off', short: 'Off', sub: 'less' },
                        ] as const
                      ).map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          aria-pressed={l.direction === d.key}
                          onClick={() => patchLine(l.key, { direction: d.key })}
                          className={`rounded-lg border px-2 py-1.5 text-[13px] font-medium ${
                            l.direction === d.key
                              ? 'border-emerald-700 bg-emerald-700 text-white'
                              : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
                          }`}
                        >
                          {d.short}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className={tdNumCls}>
                    <input
                      inputMode="decimal"
                      placeholder="0"
                      value={l.qty}
                      onChange={(e) => patchLine(l.key, { qty: e.target.value.replace(/[^\d.]/g, '') })}
                      className={`${numCls} w-24 text-right`}
                    />
                  </td>
                  <td className={tdCls}>
                    <span className="text-sm text-stone-500">{l.item?.purchase_unit ?? '—'}</span>
                  </td>
                  <td className={tdCls}>
                    <button
                      type="button"
                      onClick={() => removeLine(l.key)}
                      aria-label="Remove line"
                      className="text-sm text-stone-400 hover:text-red-700"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={addLine}
          className="rounded-full border border-rule bg-cell px-3.5 py-2 text-sm font-medium text-stone-700 hover:border-stone-400"
        >
          ＋ Add item
        </button>

        {duplicate && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            The same item is listed twice. Combine it into one line — two corrections written together cannot be
            told apart afterwards.
          </p>
        )}

        {picked === OTHER && (
          <label className="block">
            <span className={fieldLabelCls}>Say why</span>
            <input
              value={typedReason}
              onChange={(e) => setTypedReason(e.target.value)}
              placeholder="a few words — an owner decides later whether it joins the list"
              className={inputCls}
              maxLength={60}
            />
          </label>
        )}

        <label className="block">
          <span className={fieldLabelCls}>Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional — what happened"
            className={inputCls}
            maxLength={300}
          />
        </label>

        {/* The sentence per line, so the correction is read in the shelf's
            words before it is written. The book figure comes from the picker,
            which is the same stock_on_hand the correction moves. */}
        {filled.filter(lineOk).map((l) => {
          const it = l.item as IssuableItemHit
          return (
            <p key={l.key} className="text-sm text-stone-600">
              {l.direction === 'onto' ? (
                <>
                  Adds {l.qty.trim()} {it.purchase_unit} of {it.name} to the book. The book says{' '}
                  {it.on_hand_qty} {it.purchase_unit} today — it is being told the shelf holds more than that.
                </>
              ) : (
                <>
                  Takes {l.qty.trim()} {it.purchase_unit} of {it.name} off the book. The book says{' '}
                  {it.on_hand_qty} {it.purchase_unit} today — it is being told that much is not on the shelf.
                </>
              )}
            </p>
          )
        })}

        {error !== null && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <button type="button" onClick={onSave} disabled={!canSave} className={`${btnCls} w-full`}>
          {saving ? 'Correcting…' : 'Correct the book'}
        </button>
      </div>
    </section>
    </div>
  )
}
