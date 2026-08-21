'use client'

// The recipe card. Costs shown here always arrive from the server
// (recipe_costs / dish_costs / item_costs via the actions' read-backs) —
// nothing money-shaped is computed in the browser.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addLine, deleteLine, updateLineQty,
  updateLineYield, updateRecipe } from '@/server/recipes-actions'
import type { ComponentHit, RecipeDetail, RecipeLineRow, RecipeMutationResult, Unit } from '@/lib/types'
import { formatMoneyString, parseMoney, parseQty } from '@/lib/money'
import { cardCls, fieldLabelCls, heroNumCls, inputCls, numCls, sectionHeadCls, selectCls } from '@/components/ui'
import Honesty, { Doubted } from '@/components/Honesty'
import ComponentPicker from './ComponentPicker'
import SaveAck from '@/components/SaveAck'

const cleanNum = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function RecipeEditor({
  initialRecipe,
  initialLines,
  units,
}: {
  initialRecipe: RecipeDetail
  initialLines: RecipeLineRow[]
  units: Unit[]
}) {
  const [recipe, setRecipe] = useState(initialRecipe)
  const [lines, setLines] = useState(initialLines)

  const [name, setName] = useState(initialRecipe.name)
  const [outputQty, setOutputQty] = useState(initialRecipe.output_qty)
  const [outputUnit, setOutputUnit] = useState(initialRecipe.output_unit)
  const [sellingPrice, setSellingPrice] = useState(initialRecipe.selling_price ?? '')
  const [status, setStatus] = useState<'active' | 'inactive'>(initialRecipe.status)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)

  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({})
  const [yieldDrafts, setYieldDrafts] = useState<Record<string, string>>({})
  const [component, setComponent] = useState<ComponentHit | null>(null)
  const [newQty, setNewQty] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function applyResult(res: RecipeMutationResult): boolean {
    if (res.ok) {
      setRecipe(res.recipe)
      setLines(res.lines)
      setError(null)
      router.refresh()
      return true
    }
    setError(res.error)
    return false
  }

  async function run(fn: () => Promise<RecipeMutationResult>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      return applyResult(await fn())
    } catch {
      setError('Could not reach the server — nothing was saved.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const headerOk =
    name.trim() !== '' &&
    parseQty(outputQty.trim()) !== null &&
    Number(outputQty) > 0 &&
    (sellingPrice.trim() === '' || parseMoney(sellingPrice.trim()) !== null)

  async function saveHeader() {
    if (!headerOk || busy) return
    const ok = await run(() =>
      updateRecipe(recipe.id, {
        name: name.trim(),
        outputQty: outputQty.trim(),
        outputUnit,
        sellingPrice: recipe.kind === 'dish' ? sellingPrice.trim() : '',
        status,
      }),
    )
    if (ok) {
      // COSTS ARE LIVE, so the acknowledgement states the one the card now
      // carries rather than echoing what was typed. `Saved ✓` sat at the top
      // of the card while the controls are down the page.
      setAck({
        headline: `${recipe.name} saved`,
        sub:
          recipe.uncosted_lines > 0
            ? `${recipe.uncosted_lines} ${recipe.uncosted_lines === 1 ? 'ingredient has' : 'ingredients have'} no cost behind them, so the batch total below is understated — it prices them at zero.`
            : 'The cost below is read live from current issue costs, so a rate change on a bill moves it with no re-cost step.',
      })
    }
  }

  const addQtyOk = component !== null && parseQty(newQty.trim()) !== null && Number(newQty) > 0

  async function submitLine() {
    if (!addQtyOk || component === null || busy) return
    const ok = await run(() =>
      addLine({
        recipeId: recipe.id,
        component: component.kind === 'item' ? { kind: 'item', id: component.id } : { kind: 'sub', id: component.id },
        qty: newQty.trim(),
      }),
    )
    if (ok) {
      setComponent(null)
      setNewQty('')
    }
  }

  const uncosted = recipe.uncosted_lines

  return (
    <div className="mt-4 space-y-4">
      {ack !== null && <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />}
      {/* live cost — the point of the phase */}
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-800">
              {recipe.kind === 'dish' ? 'Dish cost' : 'Batch cost'}
            </div>
            <div className={`text-3xl ${heroNumCls} text-stone-900`}>
              {uncosted > 0 ? (
                <Doubted title={`${uncosted} ingredient(s) have no cost yet — this is lower than the real cost`}>
                  {formatMoneyString(recipe.total_cost)}
                </Doubted>
              ) : (
                formatMoneyString(recipe.total_cost)
              )}
            </div>
            {recipe.kind === 'sub' && (
              <div className="mt-0.5 text-sm tabular-nums text-stone-600">
                {formatMoneyString(recipe.cost_per_output_unit)} per {recipe.output_unit} · makes {recipe.output_qty}{' '}
                {recipe.output_unit}
              </div>
            )}
            {recipe.kind === 'dish' && recipe.output_qty !== '1' && (
              <div className="mt-0.5 text-sm tabular-nums text-stone-600">
                {formatMoneyString(recipe.cost_per_output_unit)} per {recipe.output_unit}
              </div>
            )}
          </div>
          {recipe.kind === 'dish' && recipe.food_cost_pct !== null && (
            <div className="text-right">
              <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-800">Food cost</div>
              <div className="text-3xl font-bold tabular-nums tracking-tight text-stone-900">
                {recipe.food_cost_pct}%
              </div>
              <div className="mt-0.5 text-sm tabular-nums text-stone-600">
                of {formatMoneyString(recipe.selling_price ?? '0')}
              </div>
            </div>
          )}
        </div>
        {uncosted > 0 && (
          <div className="mt-3">
            <Honesty
              verdict="understated"
              meter={{ filled: lines.length - uncosted, total: lines.length, unit: 'ingredients priced' }}
            >
              {uncosted} {uncosted === 1 ? 'ingredient has' : 'ingredients have'} no cost yet, so this figure is
              lower than the real one. Enter a bill for {uncosted === 1 ? 'it' : 'them'} and the cost corrects
              itself.
            </Honesty>
          </div>
        )}
        <p className="mt-2 text-xs text-stone-500">
          costed live at today’s weighted-average purchase costs · recipe_costs — it moves when your rates do
        </p>
      </section>

      {/* header details */}
      <section className={cardCls}>
        <div className="flex items-center justify-between">
          <h3 className={sectionHeadCls}>Details</h3>

        </div>
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className={fieldLabelCls}>Name</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
              }}
              className={inputCls}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>{recipe.kind === 'sub' ? 'This batch makes' : 'Output'}</span>
              <div className="flex items-center gap-2">
                <input
                  inputMode="decimal"
                  value={outputQty}
                  onChange={(e) => {
                    setOutputQty(cleanNum(e.target.value))
                  }}
                  className={`${numCls} w-20`}
                />
                <select
                  value={outputUnit}
                  onChange={(e) => {
                    setOutputUnit(e.target.value)
                  }}
                  className={selectCls}
                >
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            {recipe.kind === 'dish' ? (
              <label className="block">
                <span className={fieldLabelCls}>Selling price</span>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-stone-400">
                    ₹
                  </span>
                  <input
                    inputMode="decimal"
                    value={sellingPrice}
                    onChange={(e) => {
                      setSellingPrice(cleanNum(e.target.value))
                    }}
                    placeholder="—"
                    className={`${inputCls} pl-7`}
                  />
                </div>
                <span className="mt-1 block text-xs text-stone-500">set it to see food-cost %</span>
              </label>
            ) : (
              <div />
            )}
            <label className="block">
              <span className={fieldLabelCls}>Status</span>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as 'active' | 'inactive')
                }}
                className={selectCls}
              >
                <option value="active">Active</option>
                <option value="inactive">Retired (inactive)</option>
              </select>
              <span className="mt-1 block text-xs text-stone-500">retire, never delete</span>
            </label>
          </div>
        </div>
        <button
          type="button"
          onClick={saveHeader}
          disabled={!headerOk || busy}
          className="mt-4 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {busy ? 'Saving…' : 'Save details'}
        </button>
      </section>

      {/* lines */}
      <section className={cardCls}>
        <h3 className={sectionHeadCls}>Ingredients</h3>
        <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900">
          Enter what you take from the store, including what gets trimmed away.
        </p>
        <p className="mt-2 text-xs text-stone-600">
          <span className="font-medium">Yield</span> is how much of what you take is usable — 100% when nothing
          is lost. A fish at ₹350/kg with 55% yield costs ₹636.36 per usable kilo, and the batch cost below
          charges that. It belongs to THIS line: the same fish may be trimmed differently in another dish.
        </p>

        {lines.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No ingredients yet — add what goes in, gross.</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule-soft">
            {lines.map((l) => {
              const draft = qtyDrafts[l.id] ?? l.qty
              const dirty = draft !== l.qty
              const draftOk = parseQty(draft.trim()) !== null && Number(draft) > 0
              const yDraft = yieldDrafts[l.id] ?? l.yield_pct
              const yDirty = yDraft !== l.yield_pct
              const yNum = Number(yDraft)
              const yOk = Number.isFinite(yNum) && yNum > 0 && yNum <= 100
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] text-stone-900">{l.component_name}</span>
                      {l.is_sub && (
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700">
                          sub
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-stone-500">
                      <span className="font-mono">{l.component_code}</span>
                      {l.unit_cost !== null && <> · {formatMoneyString(l.unit_cost)}/{l.unit}</>}
                      {/* what the trim actually costs, said out loud */}
                      {!l.is_sub && l.usable_cost !== null && Number(l.yield_pct) < 100 && (
                        <span className="text-red-400">
                          {' '}
                          · {formatMoneyString(l.usable_cost)}/usable {l.unit}
                        </span>
                      )}
                      {l.uncosted && <span className="text-amber-700"> · no cost yet — bill first</span>}
                      {l.is_sub && l.sub_uncosted_lines > 0 && (
                        <span className="text-amber-700"> · {l.sub_uncosted_lines} uncosted inside</span>
                      )}
                    </div>
                  </div>
                  <input
                    inputMode="decimal"
                    value={draft}
                    onChange={(e) => setQtyDrafts((d) => ({ ...d, [l.id]: cleanNum(e.target.value) }))}
                    className={`${numCls} w-20 text-right font-mono tabular-nums`}
                    aria-label={`Quantity of ${l.component_name}`}
                  />
                  <span className="w-10 text-sm text-stone-500">{l.unit}</span>

                  {/* YIELD — the line's, not the item's.
                      A sub-recipe line shows none: the trim inside it was
                      already paid for when its own cost was worked out, and
                      applying a yield again would charge the same loss
                      twice. Below 100 is terracotta because it is a fact
                      about this ingredient, not an error; exactly 100 is
                      greyed because it is the ordinary case. */}
                  {l.is_sub ? (
                    <span className="w-16 text-center text-xs text-stone-300" title="the yields inside the sub are already applied">
                      —
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <input
                        inputMode="decimal"
                        value={yDraft}
                        onChange={(e) => setYieldDrafts((d) => ({ ...d, [l.id]: cleanNum(e.target.value) }))}
                        className={`${numCls} w-16 text-right font-mono tabular-nums ${
                          Number(yDraft) < 100 ? 'text-red-400' : 'text-stone-400'
                        }`}
                        aria-label={`Yield of ${l.component_name}, percent`}
                      />
                      <span className="text-xs text-stone-400">%</span>
                      {yDirty && (
                        <button
                          type="button"
                          disabled={!yOk || busy}
                          onClick={async () => {
                            const ok = await run(() => updateLineYield(l.id, yDraft.trim()))
                            if (ok)
                              setYieldDrafts((d) => {
                                const rest = { ...d }
                                delete rest[l.id]
                                return rest
                              })
                          }}
                          className="rounded-lg bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
                        >
                          ✓
                        </button>
                      )}
                    </span>
                  )}
                  {dirty && (
                    <button
                      type="button"
                      disabled={!draftOk || busy}
                      onClick={async () => {
                        const ok = await run(() => updateLineQty(l.id, draft.trim()))
                        if (ok)
                          setQtyDrafts((d) => {
                            const rest = { ...d }
                            delete rest[l.id]
                            return rest
                          })
                      }}
                      className="rounded-lg bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
                    >
                      ✓
                    </button>
                  )}
                  <span className="ml-auto text-[15px] font-semibold tabular-nums text-stone-900">
                    {l.line_cost !== null && !l.uncosted ? (
                      formatMoneyString(l.line_cost)
                    ) : (
                      <span className="font-normal text-amber-700">—</span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => deleteLine(l.id))}
                    aria-label={`Remove ${l.component_name}`}
                    className="rounded-md p-1 text-stone-300 hover:bg-stone-100 hover:text-stone-600"
                  >
                    ✕
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ComponentPicker
                excludeRecipeId={recipe.id}
                value={component}
                onPick={setComponent}
                onClear={() => setComponent(null)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              inputMode="decimal"
              placeholder="Qty"
              value={newQty}
              onChange={(e) => setNewQty(cleanNum(e.target.value))}
              className={`${numCls} w-24`}
            />
            {component !== null && <span className="text-sm text-stone-500">{component.unit_name}</span>}
            <button
              type="button"
              onClick={submitLine}
              disabled={!addQtyOk || busy}
              className="ml-auto rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {busy ? 'Adding…' : 'Add ingredient'}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
    </div>
  )
}
