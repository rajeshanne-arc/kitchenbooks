'use client'

// Production RECORDS batches — it never moves inventory.
//
// The closing form's shape: header (date · department), a line table, ＋ Add
// item, Note, Save. One save writes N `productions` rows sharing the header's
// date and section, because every row already carries both.
//
// VALUE IS SHOWN AS IT IS TYPED and never typed. A chef should see what a
// batch is worth while entering it; `unit_cost` is frozen server-side at save
// from the same figure, so the screen is an estimate and the saved number is
// the authority.
//
// SUBS AND DISHES, AND A QUANTITY MEANS DIFFERENT THINGS. A sub is made in
// its batch unit and prices at cost_per_output_unit; A DISH IS PRODUCED IN
// PORTIONS and prices at cost_per_portion. The picker keeps them in separate
// groups because conflating them is how a batch cost silently becomes a
// portion cost. A dish with no portions set is refused BY NAME server-side —
// the warning here is a courtesy, the refusal is the check.
//
// NO SESSION FIELD. An indent carries a session because the STORE must match
// a request to a shift; production has no counterpart doing that, so a
// session here would be a column with no reader.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DishUsage, ProducibleRow, RefillSet, SaveProductionsResult, Section } from '@/lib/types'
import { saveProductions } from '@/server/kitchen-actions'
import SaveAck from '@/components/SaveAck'
import { formatMoneyString, parseQty } from '@/lib/money'
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
import { useLang } from '@/components/useLang'
import { useBusinessToday } from '@/components/BusinessDay'

type Line = { key: number; recipeId: string; qty: string }
const newLine = (key: number): Line => ({ key, recipeId: '', qty: '' })
const cleanQty = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function ProductionEntry({
  sections,
  producibles,
  history,
  lastSets,
}: {
  sections: Section[]
  /** subs AND dishes — they differ in what a quantity means, see the picker */
  producibles: ProducibleRow[]
  /** what each department actually makes, keyed by section id in `scope`. The
   *  department is picked before the lines, so it is context the picker had and
   *  was throwing away. */
  history: DishUsage[]
  /** last production per section id, for refill — resolved on the server */
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
  const [saved, setSaved] = useState<Extract<SaveProductionsResult, { ok: true }> | null>(null)

  const byId = new Map(producibles.map((p) => [p.recipe_id, p]))

  // Ranked for THIS department, frequency then recency, and never filtered: a
  // batch made here for the first time has no history and must stay pickable.
  // Nothing is made up when the department is unpicked or has no history — the
  // list falls back to the order listProducibles gave it, which is the code
  // order, not a guess.
  const madeHere = new Map(
    history.filter((h) => h.scope === sectionId).map((h) => [h.recipe_id, h] as const),
  )
  const ranked = (kind: 'sub' | 'dish') =>
    producibles
      .filter((p) => p.kind === kind)
      .map((p) => ({ p, times: madeHere.get(p.recipe_id)?.times ?? 0, last: madeHere.get(p.recipe_id)?.last ?? '' }))
      .sort((a, b) => b.times - a.times || b.last.localeCompare(a.last))
  const patchLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [newLine(nextKey)] : ls.filter((l) => l.key !== key)))

  /** A dish with no portions set cannot be costed — cost_per_portion divides
   *  by it. The server refuses by name; this says so before the trip. */
  const noPortions = (l: Line) => {
    const p = byId.get(l.recipeId)
    return p?.kind === 'dish' && (p.portions === null || Number(p.portions) <= 0)
  }

  const filled = lines.filter((l) => l.recipeId !== '' || l.qty.trim() !== '')
  const lineOk = (l: Line) =>
    l.recipeId !== '' && parseQty(l.qty.trim()) !== null && Number(l.qty) > 0 && !noPortions(l)
  const canSave = !saving && sectionId !== '' && filled.length > 0 && filled.every(lineOk)

  /** What this line is worth, from the same figure the server will freeze —
   *  cost_per_output_unit for a sub, cost_per_portion for a dish. */
  const lineValue = (l: Line): string | null => {
    const p = byId.get(l.recipeId)
    const q = parseQty(l.qty.trim())
    if (!p || q === null || p.unit_cost === null) return null
    return (Number(l.qty) * Number(p.unit_cost)).toFixed(2)
  }

  const runningTotal = filled.reduce((n, l) => n + Number(lineValue(l) ?? 0), 0).toFixed(2)

  const last = sectionId === '' ? null : (lastSets?.[sectionId] ?? null)

  /** REFILL FROM LAST. A kitchen makes broadly the same batches every day, so
   *  the previous set is the best first guess. Everything lands editable and
   *  nothing is written until Save. */
  function refill() {
    if (last === null) return
    const usable = last.lines.filter((l) => byId.has(l.id))
    if (usable.length === 0) return
    setLines(usable.map((l, i) => ({ key: nextKey + i, recipeId: l.id, qty: l.qty })))
    setNextKey((k) => k + usable.length)
  }

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveProductions({
        date,
        sectionId,
        note: note.trim(),
        lines: filled.map((l) => ({ recipeId: l.recipeId, outputQty: l.qty.trim() })),
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
   *  DEPARTMENT stay. A chef recording batches is standing in one kitchen on
   *  one day and records several in a row — clearing the department would
   *  make them answer the same question every time. The lines clear. */
  function resetForNext() {
    setNote('')
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
  }

  return (
    <div className="space-y-4">
      {saved !== null && <ProductionAck saved={saved} onDismiss={() => setSaved(null)} />}
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>What was made</h2>
          <span className="text-xs text-stone-400">productions · subs in batches, dishes in portions</span>
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
            <span className={fieldLabelCls}>Department</span>
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
        <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-sky-800">
            Last time this department made things
          </h3>
          <p className="mt-1 text-sm text-sky-900">
            {fmtDate(last.on)} — {last.lines.length} {last.lines.length === 1 ? 'batch' : 'batches'}.
            Quantities come back editable and nothing is saved until you press Save.
          </p>
          <button
            type="button"
            onClick={refill}
            className="mt-2 rounded-full border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-800 hover:border-sky-500"
          >
            ＋ Refill from last
          </button>
        </section>
      )}

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>What was made</h2>
        <div className="mt-2 overflow-x-auto">
          <table className={dataTableCls}>
            <thead>
              <tr>
                <th className={thCls}>Sub-recipe</th>
                <th className={thNumCls}>Made</th>
                <th className={thCls}>Unit</th>
                <th className={thNumCls}>Value</th>
                <th className={thCls}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const sub = byId.get(l.recipeId)
                const v = lineValue(l)
                const missingPortions = noPortions(l)
                return (
                  <tr key={l.key} className={trCls}>
                    <td className={tdCls}>
                      <select
                        value={l.recipeId}
                        onChange={(e) => patchLine(l.key, { recipeId: e.target.value })}
                        className={selectCls}
                      >
                        <option value="">—</option>
                        {/* KEPT VISIBLY APART. A sub is made in its batch
                            unit, a dish in PORTIONS — conflating them is how
                            a batch cost silently becomes a portion cost.
                            
                            THE RANK WORKS INSIDE THAT SPLIT, NOT ACROSS IT.
                            What this department usually makes is ordered first
                            within each group and marked with its count, rather
                            than promoted into a single "usually makes" group —
                            because separating the two kinds is a CORRECTNESS
                            rule and ranking is only a speed one. When they
                            conflict, ranking gives way and works underneath. */}
                        <optgroup label="Sub-recipes — made in batches">
                          {ranked('sub').map(({ p, times }) => (
                            <option key={p.recipe_id} value={p.recipe_id}>
                              {p.code} · {p.name} ({p.unit_name})
                              {times > 0 ? ` · made ${times}×` : ''}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Dishes — made in portions">
                          {ranked('dish').map(({ p, times }) => (
                            <option key={p.recipe_id} value={p.recipe_id}>
                              {p.code} · {p.name}
                              {p.portions === null || Number(p.portions) <= 0
                                ? ' (no portions set)'
                                : ` (${p.portions} portions)`}
                              {times > 0 ? ` · made ${times}×` : ''}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </td>
                    <td className={tdNumCls}>
                      <input
                        inputMode="decimal"
                        value={l.qty}
                        onChange={(e) => patchLine(l.key, { qty: cleanQty(e.target.value) })}
                        placeholder="0"
                        className={`${numCls} w-24 text-right`}
                      />
                    </td>
                    <td className={tdCls}>
                      {/* portions for a dish, the batch unit for a sub */}
                      <span className="text-sm text-stone-500">{sub?.unit_name ?? '—'}</span>
                    </td>
                    <td className={tdNumCls}>
                      {/* read-only: a batch's worth is worked out, never typed */}
                      <span className="tabular-nums text-sm text-stone-700">
                        {v === null ? '—' : formatMoneyString(v)}
                      </span>
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
                      {missingPortions && (
                        <span className="mt-1 block text-xs text-red-700">
                          no portions set — a dish is made in portions, so set how many the recipe makes first
                        </span>
                      )}
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
            {filled.length} {filled.length === 1 ? 'batch' : 'batches'} ·{' '}
            <span className="font-semibold tabular-nums text-stone-900">
              {formatMoneyString(runningTotal)}
            </span>{' '}
            <span className="text-stone-400">— estimated; the saved cost is frozen at save</span>
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
          {saving ? 'Saving…' : 'Save'}
        </button>
      </section>
    </div>
  )
}

/**
 * A BATCH WORTH ₹0.00 IS THE THING STILL MISSING. saveProductions refuses a
 * recipe it cannot cost AT ALL, and refuses a dish with no portions set — but
 * a recipe whose ingredients have no bill behind them costs zero rather than
 * null, so it saves, and the batch sits on the books at nothing. The strip
 * says so here, where the chef is looking at that recipe, rather than leaving
 * it to be discovered in a month-end total.
 */
function ProductionAck({
  saved,
  onDismiss,
}: {
  saved: Extract<SaveProductionsResult, { ok: true }>
  onDismiss: () => void
}) {
  const free = saved.rows.filter((r) => Number(r.value) === 0)
  return (
    <SaveAck
      onDismiss={onDismiss}
      headline={
        <>
          {saved.rows.length} {saved.rows.length === 1 ? 'batch' : 'batches'} recorded —{' '}
          <span className="tabular-nums">{formatMoneyString(saved.total)}</span>
        </>
      }
      sub={`${fmtDate(saved.rows[0].prod_date)} · ${saved.rows[0].section_name}`}
      missing={
        free.length > 0
          ? [
              {
                verdict: 'costs nothing',
                text: `${free
                  .map((r) => r.recipe_name)
                  .join(', ')} came out at ₹0.00 — the ingredients on that card have no purchase bill behind them yet, so the batch is on the books at nothing. Enter the bills and every batch since re-costs itself.`,
              },
            ]
          : undefined
      }
    >
      <ul className="divide-y divide-emerald-200/60 border-y border-emerald-200/60">
        {saved.rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0">
              <span className="block truncate text-stone-900">{r.recipe_name}</span>
              <span className="block text-xs text-stone-500">
                {r.output_qty} {r.output_unit} × {formatMoneyString(r.unit_cost)}
              </span>
            </span>
            <span
              className={`shrink-0 font-semibold tabular-nums ${
                Number(r.value) === 0 ? 'text-amber-800' : 'text-stone-900'
              }`}
            >
              {formatMoneyString(r.value)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-stone-500">
        unit cost frozen at save — per batch unit for a sub, per portion for a dish · production records, it does not
        move stock
      </p>
    </SaveAck>
  )
}
