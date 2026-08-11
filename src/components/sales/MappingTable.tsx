'use client'

// The mapping screen: unmapped POS items ordered by revenue — the top rows
// are half the money, map those first. Picking a dish saves immediately;
// the row moves to the mapped list on refresh. Remapping is the same move.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DishOption, PosMapRow, UnmappedPosItem } from '@/lib/types'
import { mapPosItem } from '@/server/sales-actions'
import { formatMoneyString } from '@/lib/money'
import { sectionHeadCls, selectCls } from '@/components/ui'

function DishSelect({
  dishes,
  value,
  disabled,
  onPick,
}: {
  dishes: DishOption[]
  value: string
  disabled: boolean
  onPick: (recipeId: string) => void
}) {
  return (
    <select
      className={`${selectCls} max-w-[16rem]`}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value !== '') onPick(e.target.value)
      }}
    >
      <option value="">— pick a dish —</option>
      {dishes.map((d) => (
        <option key={d.id} value={d.id}>
          {d.code} · {d.name}
        </option>
      ))}
    </select>
  )
}

export default function MappingTable({
  unmapped,
  mapped,
  dishes,
}: {
  unmapped: UnmappedPosItem[]
  mapped: PosMapRow[]
  dishes: DishOption[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState<Record<string, string>>({})

  async function map(posItemId: string, itemName: string | null, recipeId: string) {
    setBusy(posItemId)
    setErrors((e) => ({ ...e, [posItemId]: '' }))
    try {
      const res = await mapPosItem({ posItemId, itemName: itemName ?? '', recipeId })
      if (res.ok) {
        setDone((d) => ({ ...d, [posItemId]: `${res.map.recipe_code} · ${res.map.recipe_name}` }))
        router.refresh()
      } else {
        setErrors((e) => ({ ...e, [posItemId]: res.error }))
      }
    } catch {
      setErrors((e) => ({ ...e, [posItemId]: 'Could not reach the server — nothing was saved.' }))
    } finally {
      setBusy(null)
    }
  }

  if (dishes.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
        <p className="text-[15px] font-semibold text-stone-900">No dishes to map to yet.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
          Mapping points a POS item at a dish, and the dish carries the section. Create dishes under Recipes first.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-6">
      <section>
        <h2 className={sectionHeadCls}>
          Unmapped · biggest money first
        </h2>
        {unmapped.length === 0 ? (
          <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-800">
            Everything sold so far is mapped — the sections page is telling the whole truth.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-rule-soft">
            {unmapped.map((u) => (
              <li key={u.pos_item_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-stone-900">
                    {u.item_name ?? `POS item ${u.pos_item_id}`}
                  </span>
                  <span className="block text-xs tabular-nums text-stone-500">
                    {formatMoneyString(u.revenue)} · qty {u.qty} · id {u.pos_item_id}
                  </span>
                  {errors[u.pos_item_id] && (
                    <span className="block text-xs font-medium text-red-700">{errors[u.pos_item_id]}</span>
                  )}
                </span>
                {done[u.pos_item_id] ? (
                  <span className="text-sm font-medium text-emerald-700">→ {done[u.pos_item_id]}</span>
                ) : (
                  <DishSelect
                    dishes={dishes}
                    value=""
                    disabled={busy === u.pos_item_id}
                    onPick={(rid) => map(u.pos_item_id, u.item_name, rid)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {mapped.length > 0 && (
        <section>
          <h2 className={sectionHeadCls}>Mapped</h2>
          <ul className="mt-1 divide-y divide-rule-soft">
            {mapped.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] text-stone-900">
                    {m.item_name ?? `POS item ${m.pos_item_id}`}
                  </span>
                  <span className="block text-xs text-stone-500">
                    → {m.recipe_code} · {m.recipe_name}
                    {m.section_code !== null && <span className="ml-1 font-mono text-stone-400">{m.section_code}</span>}
                  </span>
                  {errors[m.pos_item_id] && (
                    <span className="block text-xs font-medium text-red-700">{errors[m.pos_item_id]}</span>
                  )}
                </span>
                <DishSelect
                  dishes={dishes}
                  value={m.recipe_id ?? ''}
                  disabled={busy === m.pos_item_id}
                  onPick={(rid) => map(m.pos_item_id, m.item_name, rid)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
