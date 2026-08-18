'use client'

// Non-revenue: food that left the kitchen with no bill — staff meals,
// owner tables, influencers, complaint recovery. Reason from the list;
// pick the dish and its COST is frozen from dish_costs at save (the
// giveaway finally costs something), or describe it free-form with no
// cost claim. Menu value is optional context, prefilled from the menu.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DishUsage, NonRevenueRow, SaveNonRevenuesResult } from '@/lib/types'
import { saveNonRevenues, voidNonRevenue } from '@/server/cashier-actions'
import { decimalStringToPaise, formatMoneyString, formatPaise, parseMoney, parseQty } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, selectCls, sectionHeadCls } from '@/components/ui'
import { rankDishes } from '@/components/DishSuggest'
import { toast } from '@/components/Toasts'
import { useBusinessToday } from '@/components/BusinessDay'

export type GiveawayDish = { id: string; code: string; name: string; selling_price: string | null; has_cost: boolean }

type Line = {
  key: number
  reason: string
  mode: 'dish' | 'description'
  recipeId: string
  description: string
  qty: string
  menuValue: string
  menuTouched: boolean
  givenTo: string
  note: string
}
const newLine = (key: number): Line => ({
  key,
  reason: '',
  mode: 'dish',
  recipeId: '',
  description: '',
  qty: '1',
  menuValue: '',
  menuTouched: false,
  givenTo: '',
  note: '',
})

export default function NonRevenueClient({
  reasons,
  dishes,
  dishUsage,
  rows,
  giveaway,
  givenToNames,
}: {
  reasons: string[]
  dishes: GiveawayDish[]
  /** what has been given away before, and for what reason. The REASON is picked
   *  before the dish on every line, so it is context the picker already has —
   *  and a sharp one: staff meals are the same three dishes, a complaint comp is
   *  whatever went wrong that night. */
  dishUsage: DishUsage[]
  rows: NonRevenueRow[]
  giveaway: { entries: number; cost_value: string; menu_value: string }
  givenToNames: string[]
}) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const [date, setDate] = useState(businessToday)
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveNonRevenuesResult, { ok: true }> | null>(null)

  const patch = (key: number, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [newLine(nextKey)] : ls.filter((l) => l.key !== key)))

  const lineOk = (l: Line) => {
    const qtyOk = parseQty(l.qty.trim()) !== null && Number(l.qty.trim()) > 0
    const menuOk = l.menuValue.trim() === '' || parseMoney(l.menuValue.trim()) !== null
    return (
      l.reason !== '' &&
      menuOk &&
      (l.mode === 'dish' ? l.recipeId !== '' && qtyOk : l.description.trim() !== '')
    )
  }
  const canSave = !saving && lines.every(lineOk)

  // Menu value prefill: selling price × qty, until the cashier edits it.
  function syncMenuValue(key: number, nextDishId: string, nextQty: string) {
    const line = lines.find((l) => l.key === key)
    if (!line || line.menuTouched) return
    const d = dishes.find((x) => x.id === nextDishId)
    const q = parseQty(nextQty.trim())
    if (d?.selling_price != null && q !== null && q > 0) {
      const paise = Math.round((decimalStringToPaise(d.selling_price) * q) / 1000)
      patch(key, { menuValue: formatPaise(paise).replace(/[₹,]/g, '') })
    }
  }

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveNonRevenues({
        date,
        lines: lines.map((l) => ({
          reason: l.reason,
          recipeId: l.mode === 'dish' ? l.recipeId : '',
          description: l.description.trim(),
          qty: l.mode === 'dish' ? l.qty.trim() : '',
          menuValue: l.menuValue.trim(),
          givenTo: l.givenTo.trim(),
          note: l.note.trim(),
        })),
      })
      if (res.ok) {
        setSaved(res)
        setLines([newLine(nextKey)])
        setNextKey((k) => k + 1)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  async function onVoid(id: string) {
    if (busy !== null) return
    setBusy(id)
    try {
      const res = await voidNonRevenue(id)
      if (res.ok) {
        toast('Entry voided — the negative twin copies its frozen cost')
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
        <h2 className={sectionHeadCls}>Record a giveaway</h2>
        {saved !== null && (
          <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-stone-800">
            {saved.rows.length === 1 ? 'Recorded' : `${saved.rows.length} giveaways recorded`} — cost{' '}
            <span className="font-semibold tabular-nums">{formatMoneyString(saved.total)}</span>
            <ul className="mt-1 space-y-0.5">
              {saved.rows.map((r) => (
                <li key={r.id} className="text-xs text-stone-600">
                  {r.recipe_name ?? r.description} · {r.reason}
                  {Number(r.cost_value) === 0 && ' — no dish picked, no cost claim'}
                </li>
              ))}
            </ul>
          </div>
        )}
        <label className="mt-3 block sm:w-44">
          <span className={fieldLabelCls}>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
        </label>

        {/* A CARD PER GIVEAWAY. REASON IS PER LINE — argued against the
            adjustments ruling and landing the other way: a batch of stock
            corrections is one event, but a staff meal and a dish comped for a
            complaint are two events that merely got written down together,
            and the reason is what the P&L reads to tell them apart. */}
        <div className="mt-3 space-y-3">
          {lines.map((l, idx) => (
            <div key={l.key} className="rounded-xl border border-rule bg-cell p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  Giveaway {idx + 1}
                </span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    className="text-sm text-stone-400 hover:text-red-700"
                    aria-label={`Remove giveaway ${idx + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="mt-2 space-y-3">
                <label className="block">
                  <span className={fieldLabelCls}>Reason</span>
                  <select
                    value={l.reason}
                    onChange={(e) => patch(l.key, { reason: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">—</option>
                    {reasons.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex gap-2">
                  {(
                    [
                      ['dish', 'A dish went out'],
                      ['description', 'Something else'],
                    ] as const
                  ).map(([m, lbl]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => patch(l.key, { mode: m })}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                        l.mode === m
                          ? 'border-emerald-700 bg-emerald-700 text-white'
                          : 'border-stone-200 bg-white text-stone-600 hover:border-emerald-400'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                {l.mode === 'dish' ? (
                  <div className="grid grid-cols-[1fr_6rem] gap-3">
                    <label className="block">
                      <span className={fieldLabelCls}>Dish (cost frozen at save)</span>
                      <select
                        value={l.recipeId}
                        onChange={(e) => {
                          patch(l.key, { recipeId: e.target.value })
                          syncMenuValue(l.key, e.target.value, l.qty)
                        }}
                        className={selectCls}
                      >
                        <option value="">—</option>
                        {/* SCOPED AND RANKED BY THE REASON, and never instead of
                            the full list: the second group holds every dish, so
                            a first-time comp stays reachable. With no reason
                            picked yet the rank is overall frequency — the other
                            half of the same rule, not a fallback to
                            alphabetical. */}
                        {(() => {
                          const { suggested, rest } = rankDishes(dishes, dishUsage, l.reason, (d) => d.id)
                          const dishOption = (d: GiveawayDish) => (
                            <option key={d.id} value={d.id} disabled={!d.has_cost}>
                              {d.code} · {d.name}
                              {!d.has_cost ? ' (no recipe lines yet)' : ''}
                            </option>
                          )
                          return suggested.length === 0 ? (
                            dishes.map(dishOption)
                          ) : (
                            <>
                              <optgroup
                                label={l.reason === '' ? 'Given away most often' : `Usually given for “${l.reason}”`}
                              >
                                {suggested.map(dishOption)}
                              </optgroup>
                              <optgroup label="Every dish">{rest.map(dishOption)}</optgroup>
                            </>
                          )
                        })()}
                      </select>
                    </label>
                    <label className="block">
                      <span className={fieldLabelCls}>Qty</span>
                      <input
                        inputMode="decimal"
                        value={l.qty}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d.]/g, '')
                          patch(l.key, { qty: v })
                          syncMenuValue(l.key, l.recipeId, v)
                        }}
                        className={`${numCls} w-full`}
                      />
                    </label>
                  </div>
                ) : (
                  <label className="block">
                    <span className={fieldLabelCls}>What went out</span>
                    <input
                      value={l.description}
                      onChange={(e) => patch(l.key, { description: e.target.value })}
                      placeholder="describe it — no dish, no cost claim"
                      className={inputCls}
                      maxLength={200}
                    />
                  </label>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={fieldLabelCls}>Menu value (₹, optional)</span>
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={l.menuValue}
                      onChange={(e) =>
                        patch(l.key, {
                          menuTouched: true,
                          menuValue: e.target.value.replace(/[^\d.]/g, ''),
                        })
                      }
                      className={`${numCls} w-full text-right`}
                    />
                  </label>
                  <label className="block">
                    <span className={fieldLabelCls}>Given to</span>
                    <input
                      list="kb-given-to"
                      value={l.givenTo}
                      onChange={(e) => patch(l.key, { givenTo: e.target.value })}
                      placeholder="pick or add"
                      className={inputCls}
                      maxLength={120}
                    />
                  </label>
                </div>
                <label className="block">
                  <span className={fieldLabelCls}>Note</span>
                  <input
                    value={l.note}
                    onChange={(e) => patch(l.key, { note: e.target.value })}
                    placeholder="optional"
                    className={inputCls}
                    maxLength={300}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <datalist id="kb-given-to">
          {givenToNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <button
          type="button"
          onClick={addLine}
          className="mt-3 rounded-full border border-rule bg-cell px-3.5 py-2 text-sm font-medium text-stone-700 hover:border-stone-400"
        >
          ＋ Add another giveaway
        </button>

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
          {saving ? 'Saving…' : lines.length === 1 ? 'Record giveaway' : `Record ${lines.length} giveaways`}
        </button>
      </section>

      <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-violet-800">This month&apos;s giveaways</h3>
        <p className="mt-1 text-sm text-stone-800">
          <span className="text-xl font-bold tabular-nums">{formatMoneyString(giveaway.cost_value)}</span>{' '}
          <span className="text-stone-500">at cost · ×{giveaway.entries}</span>
          {Number(giveaway.menu_value) > 0 && (
            <span className="text-stone-500"> · {formatMoneyString(giveaway.menu_value)} at menu</span>
          )}
        </p>
        <p className="mt-1 text-xs text-stone-500">
          informational — this food is already inside consumption; nothing is double-counted
        </p>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Recent entries</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-rule-soft">
            {rows.map((r) => (
              <li key={r.id} className={`flex items-center justify-between gap-3 py-2.5 ${r.is_reversal ? 'opacity-60' : ''}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-stone-900">
                    {fmtDate(r.nr_date)} · {r.reason}
                    {r.recipe_name !== null ? ` · ${r.qty} × ${r.recipe_name}` : r.description !== null ? ` · ${r.description}` : ''}
                    {r.is_reversal && ' · reversal'}
                    {r.is_voided && (
                      <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                        voided
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-stone-500">
                    {r.given_to !== null && `to ${r.given_to} · `}
                    {r.menu_value !== null && `menu ${formatMoneyString(r.menu_value)} · `}
                    {r.entered_by !== null ? `by ${r.entered_by}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-sm font-semibold text-stone-900">{formatMoneyString(r.cost_value)}</span>
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
