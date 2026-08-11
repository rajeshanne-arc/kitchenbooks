'use client'

// Non-revenue: food that left the kitchen with no bill — staff meals,
// owner tables, influencers, complaint recovery. Reason from the list;
// pick the dish and its COST is frozen from dish_costs at save (the
// giveaway finally costs something), or describe it free-form with no
// cost claim. Menu value is optional context, prefilled from the menu.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { NonRevenueRow, SaveNonRevenueResult } from '@/lib/types'
import { saveNonRevenue, voidNonRevenue } from '@/server/cashier-actions'
import { decimalStringToPaise, formatMoneyString, formatPaise, parseMoney, parseQty } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import { cardCls, fieldLabelCls, inputCls, numCls, selectCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export type GiveawayDish = { id: string; code: string; name: string; selling_price: string | null; has_cost: boolean }

export default function NonRevenueClient({
  reasons,
  dishes,
  rows,
  giveaway,
  givenToNames,
}: {
  reasons: string[]
  dishes: GiveawayDish[]
  rows: NonRevenueRow[]
  giveaway: { entries: number; cost_value: string; menu_value: string }
  givenToNames: string[]
}) {
  const router = useRouter()
  const [date, setDate] = useState(todayLocal)
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<'dish' | 'description'>('dish')
  const [recipeId, setRecipeId] = useState('')
  const [description, setDescription] = useState('')
  const [qty, setQty] = useState('1')
  const [menuValue, setMenuValue] = useState('')
  const [menuTouched, setMenuTouched] = useState(false)
  const [givenTo, setGivenTo] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveNonRevenueResult, { ok: true }> | null>(null)

  const qtyOk = parseQty(qty.trim()) !== null && Number(qty.trim()) > 0
  const menuOk = menuValue.trim() === '' || parseMoney(menuValue.trim()) !== null
  const canSave =
    !saving &&
    reason !== '' &&
    menuOk &&
    (mode === 'dish' ? recipeId !== '' && qtyOk : description.trim() !== '')

  // Menu value prefill: selling price × qty, until the cashier edits it.
  function syncMenuValue(nextDishId: string, nextQty: string) {
    if (menuTouched) return
    const d = dishes.find((x) => x.id === nextDishId)
    const q = parseQty(nextQty.trim())
    if (d?.selling_price != null && q !== null && q > 0) {
      const paise = Math.round((decimalStringToPaise(d.selling_price) * q) / 1000)
      setMenuValue(formatPaise(paise).replace(/[₹,]/g, ''))
    }
  }

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveNonRevenue({
        date,
        reason,
        recipeId: mode === 'dish' ? recipeId : '',
        description: description.trim(),
        qty: mode === 'dish' ? qty.trim() : '',
        menuValue: menuValue.trim(),
        givenTo: givenTo.trim(),
        note: note.trim(),
      })
      if (res.ok) {
        setSaved(res)
        setRecipeId('')
        setDescription('')
        setQty('1')
        setMenuValue('')
        setMenuTouched(false)
        setGivenTo('')
        setNote('')
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
          <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-stone-800">
            Recorded — cost{' '}
            <span className="font-semibold tabular-nums">{formatMoneyString(saved.entry.cost_value)}</span>
            {saved.entry.recipe_name !== null && <> · {saved.entry.recipe_name}</>}
            {Number(saved.entry.cost_value) === 0 && ' (no dish picked — no cost claim)'}
          </p>
        )}
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Reason</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={selectCls}>
                <option value="">—</option>
                {reasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>

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
                onClick={() => setMode(m)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                  mode === m
                    ? 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-stone-200 bg-white text-stone-600 hover:border-emerald-400'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          {mode === 'dish' ? (
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <label className="block">
                <span className={fieldLabelCls}>Dish (cost frozen at save)</span>
                <select
                  value={recipeId}
                  onChange={(e) => {
                    setRecipeId(e.target.value)
                    syncMenuValue(e.target.value, qty)
                  }}
                  className={selectCls}
                >
                  <option value="">—</option>
                  {dishes.map((d) => (
                    <option key={d.id} value={d.id} disabled={!d.has_cost}>
                      {d.code} · {d.name}
                      {!d.has_cost ? ' (no recipe lines yet)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Qty</span>
                <input
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.]/g, '')
                    setQty(v)
                    syncMenuValue(recipeId, v)
                  }}
                  className={`${numCls} w-full`}
                />
              </label>
            </div>
          ) : (
            <label className="block">
              <span className={fieldLabelCls}>What went out</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
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
                value={menuValue}
                onChange={(e) => {
                  setMenuTouched(true)
                  setMenuValue(e.target.value.replace(/[^\d.]/g, ''))
                }}
                className={`${numCls} w-full text-right`}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Given to</span>
              <input list="kb-given-to" value={givenTo} onChange={(e) => setGivenTo(e.target.value)} placeholder="pick or add" className={inputCls} maxLength={120} />
              <datalist id="kb-given-to">
                {givenToNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
          </div>
          <label className="block">
            <span className={fieldLabelCls}>Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
          </label>
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
          {saving ? 'Saving…' : 'Record giveaway'}
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
