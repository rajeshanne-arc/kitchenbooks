'use client'

// The itemized closing. The chef lists what the section still holds —
// raw items, sub batches, plated dishes — with QUANTITIES only; every
// line's cost is frozen server-side at save and the header closing_value
// becomes the SUM of the lines. Food cost keeps reading the header.
// Today's productions are one-tap suggestions: what was made today is
// what's most likely still on the shelf tonight. Zero lines is a real
// closing — an empty section is information. Latest filing per
// (section, date) wins; corrections wear the marker.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  ClosingChecklistRow,
  KitchenComponentHit,
  ProductionRow,
  RefillSet,
  SaveItemizedClosingResult,
  Section,
} from '@/lib/types'
import { saveItemizedClosing } from '@/server/kitchen-actions'
import SaveAck, { type Missing } from '@/components/SaveAck'
import { formatMoneyString, parseQty } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls } from '@/components/ui'
import KitchenComponentPicker from './KitchenComponentPicker'
import { useLang } from '@/components/useLang'
import { useBusinessToday } from '@/components/BusinessDay'

type Line = {
  key: number
  component: KitchenComponentHit | null
  qty: string
  /** the quantity this line ARRIVED with from a refill, if it did. Kept so
   *  the reveal can say which lines were saved without being touched. */
  prefillQty?: string
}
const newLine = (key: number): Line => ({ key, component: null, qty: '' })
const cleanQty = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function ClosingEntry({
  sections,
  checklist,
  todaysProductions,
  lastSets,
}: {
  sections: Section[]
  /** every closable department and whether it is closed tonight. It lives on
   *  the page below too; the acknowledgement repeats it because after a save
   *  the reader is at the TOP of the form and the checklist is off-screen. */
  checklist: ClosingChecklistRow[]
  todaysProductions: ProductionRow[]
  /** last winning closing per section id, for refill — resolved server-side */
  lastSets?: Record<string, RefillSet>
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
  const [saved, setSaved] = useState<Extract<SaveItemizedClosingResult, { ok: true }> | null>(null)
  const [savedUntouched, setSavedUntouched] = useState(0)

  const patchLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [newLine(nextKey)] : ls.filter((l) => l.key !== key)))

  const filled = lines.filter((l) => l.component !== null || l.qty.trim() !== '')
  const lineOk = (l: Line) => l.component !== null && parseQty(l.qty.trim()) !== null && Number(l.qty) > 0
  const canSave = !saving && sectionId !== '' && filled.every(lineOk)
  const isEmptyClosing = filled.length === 0

  const last = sectionId === '' ? null : (lastSets?.[sectionId] ?? null)

  /** Lines saved exactly as they arrived from the refill.
   *
   *  A closing feeds food cost and COGS, so prefilling it carries a real
   *  risk: a chef can save last night's numbers without recounting, which is
   *  worse than a blank form because it looks like a count. It is NOT
   *  blocked — a shelf genuinely can hold the same thing two nights running,
   *  and blocking would teach people to nudge a digit to get past it. It is
   *  SAID, on the reveal, where it can still be re-filed. */
  const untouched = lines.filter(
    (l) => l.prefillQty !== undefined && l.qty.trim() === l.prefillQty && l.component !== null,
  ).length

  /** REFILL FROM LAST NIGHT. Editable, saves nothing until Save. */
  function refill() {
    if (last === null) return
    setLines(
      last.lines.map((l, i) => ({
        key: nextKey + i,
        component: {
          kind: l.kind,
          id: l.id,
          code: l.code,
          name: l.name,
          unit_name: l.unit_name,
          has_cost: true,
          unit_cost: null,
          // true, and truthfully: this line came off THIS department's own
          // closing last night, which is the definition of a component it
          // handles.
          from_section: true,
        },
        qty: l.qty,
        prefillQty: l.qty,
      })),
    )
    setNextKey((k) => k + last.lines.length)
  }

  const suggestions =
    sectionId === ''
      ? []
      : todaysProductions.filter(
          (p) =>
            p.section_id === sectionId &&
            !lines.some((l) => l.component?.kind === 'sub' && l.component.id === p.recipe_id),
        )

  function addSuggestion(p: ProductionRow) {
    const hit: KitchenComponentHit = {
      kind: 'sub',
      id: p.recipe_id,
      code: p.recipe_code,
      name: p.recipe_name,
      unit_name: p.output_unit,
      has_cost: true,
      // the batch's own frozen cost — the same figure the closing will freeze
      unit_cost: p.unit_cost,
      // this batch was made BY this department today
      from_section: true,
    }
    setLines((ls) => {
      const empty = ls.findIndex((l) => l.component === null && l.qty.trim() === '')
      const line = { key: nextKey, component: hit, qty: p.output_qty }
      if (empty === -1) return [...ls, line]
      const copy = [...ls]
      copy[empty] = line
      return copy
    })
    setNextKey((k) => k + 1)
  }

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveItemizedClosing({
        date,
        sectionId,
        note: note.trim(),
        lines: filled.map((l) => {
          const c = l.component as KitchenComponentHit
          return { kind: c.kind, id: c.id, qty: l.qty.trim() }
        }),
      })
      if (res.ok) {
        setSavedUntouched(untouched)
        setSaved(res)
        resetForNext()
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the closing was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  /** Reset for the next entry, keeping what carries: the DATE stays, the
   *  DEPARTMENT clears. Closing is done department by department, and filing
   *  the same one twice is a CORRECTION rather than the next entry — so this
   *  is the one batch form where the department must not carry. */
  function resetForNext() {
    setSectionId('')
    setNote('')
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
  }

  return (
    <div className="space-y-4">
      {saved !== null && (
        <ClosingAck
          saved={saved}
          untouched={savedUntouched}
          checklist={checklist}
          onDismiss={() => setSaved(null)}
        />
      )}
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>{label('closing_title')}</h2>
          <span className="text-xs text-stone-400">latest per section wins · kitchen_closing_current</span>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-[11rem_1fr]">
          <label className="block">
            <span className={fieldLabelCls}>{label('date')}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
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

      {last !== null && last.lines.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-amber-900">
            From last night — check every line
          </h3>
          <p className="mt-1 text-sm text-amber-900">
            {fmtDate(last.on)} — {last.lines.length} {last.lines.length === 1 ? 'line' : 'lines'}.
            This is a starting point, not a count: a closing feeds food cost and cost of goods, so
            anything you do not recount will be wrong in the books rather than merely stale.
          </p>
          <button
            type="button"
            onClick={refill}
            className="mt-2 rounded-full border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:border-amber-600"
          >
            ＋ Start from last night
          </button>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-sky-800">Made today — still on the shelf?</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addSuggestion(p)}
                className="rounded-full border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-800 hover:border-sky-500"
              >
                ＋ {p.recipe_name} · {p.output_qty} {p.output_unit}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>What the section still holds</h2>
        <div className="mt-1 divide-y divide-rule-soft">
          {lines.map((line, i) => (
            <div key={line.key} className="space-y-2 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <KitchenComponentPicker
                    value={line.component}
                    sectionId={sectionId}
                    onPick={(hit) => patchLine(line.key, { component: hit })}
                    onClear={() => patchLine(line.key, { component: null })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  aria-label={`Remove line ${i + 1}`}
                  className="mt-1.5 shrink-0 rounded-md p-1 text-stone-300 hover:bg-stone-100 hover:text-stone-600"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  inputMode="decimal"
                  placeholder="Qty"
                  value={line.qty}
                  onChange={(e) => patchLine(line.key, { qty: cleanQty(e.target.value) })}
                  className={`${numCls} w-24`}
                />
                {line.component !== null && <span className="text-sm text-stone-500">{line.component.unit_name}</span>}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-3 w-full rounded-xl border border-dashed border-stone-300 py-2.5 text-sm font-medium text-stone-500 hover:border-emerald-400 hover:text-emerald-700"
        >
          ＋ {label('add_item')}
        </button>
        <label className="mt-3 block">
          <span className={fieldLabelCls}>{label('note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
        </label>
        <p className="mt-2 text-xs text-stone-400">
          Quantities only — every cost is frozen from the live books at save. No prices to type, none shown.
        </p>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        className="w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {saving ? label('saving') : isEmptyClosing ? 'Save empty closing (₹0)' : label('save')}
      </button>
      {isEmptyClosing && (
        <p className="text-center text-xs text-stone-400">Zero is a real closing — an empty section is information.</p>
      )}
    </div>
  )
}

/**
 * WHAT IS STILL MISSING HERE IS THE OTHER DEPARTMENTS. A closing is what
 * cost of goods subtracts, so a kitchen that files six of eight and goes home
 * leaves the month unclosable — and section_food_cost will correctly refuse
 * to state a figure rather than guess. Naming the gap at the moment the chef
 * is still standing at the screen is the whole point of saying it here.
 *
 * The not-recounted count is the alarm twin: a line saved with the quantity
 * it was PREFILLED with looks exactly like a counted one, and food cost reads
 * this number either way.
 */
function ClosingAck({
  saved,
  untouched,
  checklist,
  onDismiss,
}: {
  saved: Extract<SaveItemizedClosingResult, { ok: true }>
  untouched: number
  checklist: ClosingChecklistRow[]
  onDismiss: () => void
}) {
  const c = saved.closing
  const open = checklist.filter((r) => r.closing_value === null)
  const missing: Missing[] = []
  if (untouched > 0) {
    missing.push({
      level: 'alarm',
      verdict: 'not recounted',
      text: (
        <>
          {untouched} of {saved.lines.length} {untouched === 1 ? 'line was' : 'lines were'} saved exactly as last
          night&apos;s closing, unchanged. If the shelf was not actually recounted, file this closing again — food cost
          and cost of goods both read this number.
        </>
      ),
    })
  }
  if (open.length > 0) {
    missing.push({
      verdict: 'still open',
      meter: { filled: checklist.length - open.length, total: checklist.length, unit: 'departments closed' },
      text: (
        <>
          {open.map((r) => r.name).join(', ')} {open.length === 1 ? 'has' : 'have'} not closed tonight. Cost of goods
          subtracts the closing, so the month cannot be stated until every one is in — zero is a real closing and takes
          two taps.
        </>
      ),
    })
  }
  return (
    <SaveAck
      onDismiss={onDismiss}
      headline={
        <>
          {c.section_name} closed — <span className="tabular-nums">{formatMoneyString(c.closing_value)}</span>
          {c.filings > 1 && (
            <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 align-middle text-[11px] font-medium text-amber-800">
              corrected ×{c.filings - 1}
            </span>
          )}
        </>
      }
      sub={`${fmtDate(c.close_date)} · latest filing wins · costs frozen at save`}
      missing={missing.length > 0 ? missing : undefined}
    >
      {saved.lines.length === 0 ? (
        <p className="text-sm text-stone-600">
          Empty closing — the department holds nothing tonight. That is information, not a blank.
        </p>
      ) : (
        <ul className="divide-y divide-emerald-200/60 border-y border-emerald-200/60">
          {saved.lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-stone-900">{l.component_name}</span>
                <span className="block text-xs text-stone-500">
                  {l.qty} {l.unit} × {formatMoneyString(l.unit_cost)} <span className="uppercase">({l.kind})</span>
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-stone-900">{formatMoneyString(l.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </SaveAck>
  )
}
