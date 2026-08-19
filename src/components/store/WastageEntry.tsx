'use client'

// Store loss, in the closing form's shape: a date header, a line table,
// ＋ Add item, Note, Save. One save writes N `wastage` rows sharing the
// header's date — every row already carries its own date, so nothing about
// how they are read changes.
//
// REASON IS PER LINE. Spoilage and breakage happen in the same bin on the
// same day for different reasons, and the reason is what makes the waste
// report worth reading. It was per-save before, which meant a second reason
// cost a second trip through the whole form.
//
// NOTHING TO TYPE BUT A QUANTITY. unit_cost is frozen from
// item_costs.issue_cost at save and `value` is GENERATED, so the rupee figure
// belongs to the reveal — waste has a cost and the screen says so plainly.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IssuableItemHit, SaveStoreLossesResult } from '@/lib/types'
import { saveStoreLosses } from '@/server/store-actions'
import SaveAck from '@/components/SaveAck'
import { parseQty, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import {
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
import IssueItemPicker from './IssueItemPicker'
import { useLang } from '@/components/useLang'
import { useBusinessToday } from '@/components/BusinessDay'

type Line = { key: number; item: IssuableItemHit | null; qty: string; reason: string; note: string }
const newLine = (key: number): Line => ({ key, item: null, qty: '', reason: '', note: '' })
const cleanQty = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function WastageEntry({ reasons }: { reasons: string[] }) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const { label } = useLang()
  const [date, setDate] = useState(businessToday)
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveStoreLossesResult, { ok: true }> | null>(null)

  const patchLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [newLine(nextKey)] : ls.filter((l) => l.key !== key)))

  const filled = lines.filter((l) => l.item !== null || l.qty.trim() !== '' || l.reason !== '')
  const lineOk = (l: Line) =>
    l.item !== null && parseQty(l.qty.trim()) !== null && Number(l.qty) > 0 && l.reason !== ''
  const canSave = !saving && filled.length > 0 && filled.every(lineOk) && reasons.length > 0

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveStoreLosses({
        date,
        note: note.trim(),
        lines: filled.map((l) => ({
          itemId: (l.item as IssuableItemHit).id,
          qty: l.qty.trim(),
          reason: l.reason,
          note: l.note.trim(),
        })),
      })
      if (res.ok) {
        setSaved(res)
        resetForNext()
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was recorded. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  /** Reset for the next entry, keeping what carries: the DATE stays (a day's
   *  losses are written up together), the lines and the note clear. */
  function resetForNext() {
    setNote('')
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
  }

  return (
    <div className="space-y-4">
      {saved !== null && <LossAck saved={saved} onDismiss={() => setSaved(null)} />}
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>{label('wastage_title')}</h2>
          <span className="text-xs text-stone-400">wastage · cost frozen at save</span>
        </div>
        <label className="mt-3 block sm:w-44">
          <span className={fieldLabelCls}>{label('date')}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`${numCls} w-full`}
          />
        </label>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>What was lost</h2>

        {reasons.length === 0 && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No waste reasons are set up, so nothing can be recorded yet. An owner or manager adds
            them under Settings → Lists.
          </p>
        )}

        <div className="mt-2 overflow-x-auto">
          <table className={dataTableCls}>
            <thead>
              <tr>
                <th className={thCls}>Item</th>
                <th className={thNumCls}>Qty</th>
                <th className={thCls}>Unit</th>
                <th className={thCls}>Reason</th>
                <th className={thCls}>Note</th>
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
                  <td className={tdNumCls}>
                    <input
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => patchLine(l.key, { qty: cleanQty(e.target.value) })}
                      placeholder="0"
                      className={`${numCls} w-20 text-right`}
                    />
                  </td>
                  <td className={tdCls}>
                    <span className="text-sm text-stone-500">{l.item?.unit_name ?? '—'}</span>
                  </td>
                  <td className={tdCls}>
                    {/* PER LINE. Two things in the same bin on the same day are
                        usually lost for two different reasons. */}
                    <select
                      value={l.reason}
                      onChange={(e) => patchLine(l.key, { reason: e.target.value })}
                      className={selectCls}
                    >
                      <option value="">—</option>
                      {reasons.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={tdCls}>
                    <input
                      value={l.note}
                      onChange={(e) => patchLine(l.key, { note: e.target.value })}
                      placeholder="optional"
                      className={`${inputCls} w-32`}
                    />
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
          className="mt-3 rounded-full border border-rule bg-cell px-3.5 py-2 text-sm font-medium text-stone-700 hover:border-stone-400"
        >
          ＋ Add item
        </button>

        <label className="mt-3 block">
          <span className={fieldLabelCls}>{label('note')}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional — used for any line with no note of its own"
            className={`${inputCls} w-full`}
          />
        </label>

        {error !== null && (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="mt-3 w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:bg-stone-300"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </section>
    </div>
  )
}

/**
 * Numbers, then the form again. `stock` comes back from the same save, so
 * the one thing worth saying beyond the total is a shelf that has gone
 * negative — the loss did not cause it, but this is the moment somebody is
 * looking at that item.
 */
function LossAck({
  saved,
  onDismiss,
}: {
  saved: Extract<SaveStoreLossesResult, { ok: true }>
  onDismiss: () => void
}) {
  const short = saved.stock.filter((s) => Number(s.on_hand_qty) < 0)
  return (
    <SaveAck
      onDismiss={onDismiss}
      headline={
        <>
          {saved.rows.length} {saved.rows.length === 1 ? 'loss' : 'losses'} recorded —{' '}
          <span className="tabular-nums">{formatMoneyString(saved.total)}</span>
        </>
      }
      sub={`${fmtDate(saved.rows[0].waste_date)} · cost frozen at save from the purchase history`}
      missing={
        short.length > 0
          ? [
              {
                level: 'alarm' as const,
                verdict: 'negative stock',
                text: `${short
                  .map((s) => `${s.name} is at ${s.on_hand_qty} ${s.purchase_unit}`)
                  .join(', ')} — more has left the store than the book says was ever bought. A bill is probably missing.`,
              },
            ]
          : undefined
      }
      actions={[{ href: '/store/books/log', label: 'Store log' }]}
    >
      <ul className="divide-y divide-emerald-200/60 border-y border-emerald-200/60">
        {saved.rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0">
              <span className="block truncate text-stone-900">{r.item_name}</span>
              <span className="block text-xs text-stone-500">
                {r.qty} {r.purchase_unit} · {r.reason}
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-stone-900">{formatMoneyString(r.value)}</span>
          </li>
        ))}
      </ul>
    </SaveAck>
  )
}
