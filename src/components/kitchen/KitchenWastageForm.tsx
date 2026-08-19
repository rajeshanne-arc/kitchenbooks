'use client'

// Kitchen loss, in the closing form's shape: header (date · department), a
// line table, ＋ Add item, Note, Save. One save writes N `kitchen_wastage`
// rows sharing the header's date and section — every row already carries
// both, so a batch is N ordinary rows.
//
// REASON IS PER LINE, and this is the one place loss must differ from
// closing. Burnt gravy and expired milk go in the same bin on the same night
// for different reasons, and the reason is what makes waste analysis worth
// anything. Four write-offs from one shift used to be four saves with the
// department and date re-picked each time.
//
// VALUE IS COMPUTED, NEVER TYPED — qty × the component's frozen cost, from
// the same figures the server freezes at save. Value-only survives as a
// PER-LINE fallback for "half a tray of gravy", where a quantity means
// nothing: the exception, not the mode.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { KitchenComponentHit, SaveKitchenLossesResult, Section } from '@/lib/types'
import { saveKitchenLosses } from '@/server/kitchen-actions'
import SaveAck from '@/components/SaveAck'
import { formatMoneyString, parseMoney, parseQty } from '@/lib/money'
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
import KitchenComponentPicker from './KitchenComponentPicker'
import { useLang } from '@/components/useLang'
import { useBusinessToday } from '@/components/BusinessDay'

type Line = {
  key: number
  component: KitchenComponentHit | null
  qty: string
  reason: string
  /** value-only mode: no component, a typed rupee figure */
  valueOnly: boolean
  value: string
}
const newLine = (key: number): Line => ({
  key,
  component: null,
  qty: '',
  reason: '',
  valueOnly: false,
  value: '',
})
const cleanQty = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function KitchenWastageForm({
  sections,
  wasteReasons,
}: {
  sections: Section[]
  wasteReasons: string[]
}) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const { label } = useLang()
  const [date, setDate] = useState(businessToday)
  const [sectionId, setSectionId] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveKitchenLossesResult, { ok: true }> | null>(null)

  const patchLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [newLine(nextKey)] : ls.filter((l) => l.key !== key)))

  const touched = (l: Line) =>
    l.component !== null || l.qty.trim() !== '' || l.reason !== '' || l.value.trim() !== ''
  const filled = lines.filter(touched)
  const lineOk = (l: Line) => {
    if (l.reason === '') return false
    if (l.valueOnly) {
      const v = parseMoney(l.value.trim())
      return v !== null && v > 0
    }
    return l.component !== null && parseQty(l.qty.trim()) !== null && Number(l.qty) > 0
  }
  const canSave =
    !saving && sectionId !== '' && filled.length > 0 && filled.every(lineOk) && wasteReasons.length > 0

  /** What a line is worth, from the same cost the server will freeze. */
  const lineValue = (l: Line): string | null => {
    if (l.valueOnly) {
      const v = parseMoney(l.value.trim())
      return v === null ? null : (v / 100).toFixed(2)
    }
    const q = parseQty(l.qty.trim())
    if (l.component === null || q === null || l.component.unit_cost === null) return null
    return (Number(l.qty) * Number(l.component.unit_cost)).toFixed(2)
  }
  const runningTotal = filled.reduce((n, l) => n + Number(lineValue(l) ?? 0), 0).toFixed(2)

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveKitchenLosses({
        date,
        sectionId,
        note: note.trim(),
        lines: filled.map((l) => {
          if (l.valueOnly) return { kind: 'none' as const, value: l.value.trim(), reason: l.reason }
          const c = l.component as KitchenComponentHit
          return c.kind === 'item'
            ? { kind: 'item' as const, id: c.id, qty: l.qty.trim(), reason: l.reason }
            : { kind: 'recipe' as const, id: c.id, qty: l.qty.trim(), reason: l.reason }
        }),
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

  /** Reset for the next entry, keeping what carries: the DATE and the
   *  DEPARTMENT stay — a chef writing up a shift's losses is in one kitchen
   *  on one day. The lines and note clear. */
  function resetForNext() {
    setNote('')
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
  }

  return (
    <div className="space-y-4">
      {saved !== null && <KitchenLossAck saved={saved} onDismiss={() => setSaved(null)} />}
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>{label('kitchen_wastage_title')}</h2>
          <span className="text-xs text-stone-400">kitchen_wastage · cost frozen at save</span>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-[11rem_1fr]">
          <label className="block">
            <span className={fieldLabelCls}>{label('date')}</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${numCls} w-full`}
            />
          </label>
          <div>
            <span className={fieldLabelCls}>{label('section')}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSectionId(s.id)}
                  className={`rounded-xl border px-2 py-2 text-sm font-medium ${
                    sectionId === s.id
                      ? 'border-emerald-700 bg-emerald-700 text-white'
                      : 'border-stone-200 bg-white text-stone-700 hover:border-emerald-400'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>What was lost</h2>

        {wasteReasons.length === 0 && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No waste reasons are set up, so nothing can be recorded yet. An owner or manager adds
            them under Settings → Lists.
          </p>
        )}

        <div className="mt-2 overflow-x-auto">
          <table className={dataTableCls}>
            <thead>
              <tr>
                <th className={thCls}>What was lost</th>
                <th className={thNumCls}>{label('quantity')}</th>
                <th className={thCls}>Unit</th>
                <th className={thCls}>{label('reason')}</th>
                <th className={thNumCls}>Value</th>
                <th className={thCls}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const v = lineValue(l)
                return (
                  <tr key={l.key} className={trCls}>
                    <td className={tdCls}>
                      {l.valueOnly ? (
                        <span className="text-sm text-stone-500">
                          Value only
                          <button
                            type="button"
                            onClick={() => patchLine(l.key, { valueOnly: false, value: '' })}
                            className="ml-2 text-xs text-emerald-700 underline underline-offset-2"
                          >
                            pick an item
                          </button>
                        </span>
                      ) : (
                        <>
                          <KitchenComponentPicker
                            value={l.component}
                            sectionId={sectionId}
                            onPick={(hit) => patchLine(l.key, { component: hit })}
                            onClear={() => patchLine(l.key, { component: null })}
                          />
                          {l.component === null && (
                            <button
                              type="button"
                              onClick={() => patchLine(l.key, { valueOnly: true, qty: '' })}
                              className="mt-1 text-xs text-stone-500 underline underline-offset-2 hover:text-stone-800"
                            >
                              no quantity — value only
                            </button>
                          )}
                        </>
                      )}
                    </td>
                    <td className={tdNumCls}>
                      <input
                        inputMode="decimal"
                        value={l.qty}
                        disabled={l.valueOnly}
                        onChange={(e) => patchLine(l.key, { qty: cleanQty(e.target.value) })}
                        placeholder={l.valueOnly ? '—' : '0'}
                        className={`${numCls} w-20 text-right disabled:bg-stone-100 disabled:text-stone-400`}
                      />
                    </td>
                    <td className={tdCls}>
                      <span className="text-sm text-stone-500">
                        {l.valueOnly ? '—' : (l.component?.unit_name ?? '—')}
                      </span>
                    </td>
                    <td className={tdCls}>
                      {/* PER LINE — burnt gravy and expired milk, same bin,
                          same night, different reasons. */}
                      <select
                        value={l.reason}
                        onChange={(e) => patchLine(l.key, { reason: e.target.value })}
                        className={selectCls}
                      >
                        <option value="">—</option>
                        {wasteReasons.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={tdNumCls}>
                      {l.valueOnly ? (
                        <input
                          inputMode="decimal"
                          value={l.value}
                          onChange={(e) =>
                            patchLine(l.key, { value: e.target.value.replace(/[^\d.]/g, '') })
                          }
                          placeholder="0.00"
                          className={`${numCls} w-24 text-right`}
                        />
                      ) : (
                        // computed, read-only: the chef never types a cost
                        <span className="tabular-nums text-sm text-stone-700">
                          {v === null ? '—' : formatMoneyString(v)}
                        </span>
                      )}
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
                )
              })}
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

        {filled.length > 0 && (
          <p className="mt-3 text-sm text-stone-600">
            {filled.length} {filled.length === 1 ? 'line' : 'lines'} ·{' '}
            <span className="font-semibold tabular-nums text-stone-900">
              {formatMoneyString(runningTotal)}
            </span>{' '}
            <span className="text-stone-400">— the saved cost is frozen at save</span>
          </p>
        )}

        <label className="mt-3 block">
          <span className={fieldLabelCls}>{label('note')}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional"
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
          {saving ? label('saving') : label('record_kitchen_wastage')}
        </button>
      </section>
    </div>
  )
}

/**
 * A VALUE-ONLY LINE MAKES NO CLAIM ABOUT WHAT WAS LOST, and that is a real
 * difference worth saying at the moment it is written: half a tray of gravy
 * is a true rupee figure with nothing behind it, so it never reaches
 * stock_on_hand and never names an item in the waste report.
 */
function KitchenLossAck({
  saved,
  onDismiss,
}: {
  saved: Extract<SaveKitchenLossesResult, { ok: true }>
  onDismiss: () => void
}) {
  const valueOnly = saved.rows.filter((r) => r.item_name === null && r.recipe_name === null)
  return (
    <SaveAck
      onDismiss={onDismiss}
      headline={
        <>
          {saved.rows.length} {saved.rows.length === 1 ? 'loss' : 'losses'} recorded —{' '}
          <span className="tabular-nums">{formatMoneyString(saved.total)}</span>
        </>
      }
      sub={`${fmtDate(saved.rows[0].waste_date)} · ${saved.rows[0].section_name} · cost frozen at save from the live books`}
      missing={
        valueOnly.length > 0
          ? [
              {
                verdict: 'value only',
                text: `${valueOnly.length} of these ${
                  valueOnly.length === 1 ? 'names no component' : 'name no component'
                } — the rupee figure is on record and counts against the kitchen, but nothing says WHAT was lost, so it never reaches the waste report by item. Where you can name the item or the batch, name it.`,
              },
            ]
          : undefined
      }
    >
      <ul className="divide-y divide-emerald-200/60 border-y border-emerald-200/60">
        {saved.rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0">
              <span className="block truncate text-stone-900">{r.item_name ?? r.recipe_name ?? 'Value only'}</span>
              <span className="block text-xs text-stone-500">{r.reason}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-stone-900">{formatMoneyString(r.value)}</span>
          </li>
        ))}
      </ul>
    </SaveAck>
  )
}
