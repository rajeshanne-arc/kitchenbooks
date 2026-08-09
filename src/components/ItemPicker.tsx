'use client'

import { useState } from 'react'
import type { Category, ItemHit, ItemHitExisting, ItemSel, Unit } from '@/lib/types'
import { formatMoneyString } from '@/lib/money'
import { useSearch } from './useSearch'
import { inputCls, selectCls } from './ui'

const headingCls = 'px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400'

export default function ItemPicker({
  categories,
  units,
  value,
  onPick,
  onChange,
  onClear,
}: {
  categories: Category[]
  units: Unit[]
  value: ItemSel | null
  /** fresh selection from the dropdown; second arg is item_rates.prefill_rate if known */
  onPick: (sel: ItemSel, prefillRate: string | null) => void
  /** edits inside the starter/new strips (unit, name, category) */
  onChange: (sel: ItemSel) => void
  onClear: () => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const { results, loading } = useSearch<ItemHit>(open ? `/api/items/search?q=${encodeURIComponent(q)}` : null)

  if (value?.kind === 'existing') {
    const hit = value.hit
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-stone-900">{hit.name}</div>
          <div className="text-xs text-stone-500">
            <span className="font-mono">{hit.code}</span> · {hit.category_name}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onClear()
            setQ('')
          }}
          aria-label="Change item"
          className="shrink-0 rounded-md p-1 text-stone-400 hover:bg-white hover:text-stone-600"
        >
          ✕
        </button>
      </div>
    )
  }

  if (value?.kind === 'starter') {
    const hit = value.hit
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium text-stone-900">{hit.name}</div>
            <div className="text-xs text-emerald-800/80">
              from starter library · becomes <span className="font-mono font-medium">{hit.category}-###</span> on save
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onClear()
              setQ('')
            }}
            aria-label="Remove item"
            className="shrink-0 rounded-md p-1 text-stone-400 hover:bg-white hover:text-stone-600"
          >
            ✕
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          Unit
          <select
            value={value.unit}
            onChange={(e) => onChange({ ...value, unit: e.target.value })}
            className={`${selectCls} w-auto`}
          >
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    )
  }

  if (value?.kind === 'new') {
    return (
      <div className="space-y-2.5 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            New item — saved with this bill
          </span>
          <button
            type="button"
            onClick={() => {
              onClear()
              setQ('')
            }}
            aria-label="Cancel new item"
            className="rounded-md p-1 text-stone-400 hover:bg-white hover:text-stone-600"
          >
            ✕
          </button>
        </div>
        <input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="Item name"
          className={inputCls}
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={value.category}
            onChange={(e) => onChange({ ...value, category: e.target.value })}
            className={selectCls}
          >
            <option value="">Category…</option>
            <optgroup label="Ingredients">
              {categories
                .filter((c) => c.kind === 'ingredient')
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Operational">
              {categories
                .filter((c) => c.kind === 'operational')
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          </select>
          <select value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value })} className={selectCls}>
            <option value="">Unit…</option>
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-emerald-800/80">
          {value.category ? (
            <>
              Code assigns as <span className="font-mono font-medium">{value.category}-###</span> on save
            </>
          ) : (
            'The category sets the item code series (VEG-001, VEG-002, …)'
          )}
        </p>
      </div>
    )
  }

  const itemHits = (results ?? []).filter((h): h is ItemHitExisting => h.kind === 'item')
  const starterHits = (results ?? []).filter((h) => h.kind === 'starter')

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Item — search or add"
        className={inputCls}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg">
          {loading && results === null && <div className="px-3 py-2.5 text-sm text-stone-400">Searching…</div>}
          {itemHits.length > 0 && <div className={headingCls}>Your items</div>}
          {itemHits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick({ kind: 'existing', hit }, hit.prefill_rate)
                setOpen(false)
                setQ('')
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-stone-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] text-stone-900">{hit.name}</span>
                <span className="block text-xs text-stone-500">
                  <span className="font-mono">{hit.code}</span> · {hit.category_name} · {hit.unit_name}
                </span>
              </span>
              {hit.prefill_rate !== null && (
                <span className="shrink-0 text-xs text-stone-500">last {formatMoneyString(hit.prefill_rate)}</span>
              )}
            </button>
          ))}
          {starterHits.length > 0 && <div className={headingCls}>Starter library</div>}
          {starterHits.map((hit) => (
            <button
              key={`s${hit.starter_id}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick({ kind: 'starter', hit, unit: hit.purchase_unit }, null)
                setOpen(false)
                setQ('')
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-stone-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] text-stone-900">{hit.name}</span>
                <span className="block text-xs text-stone-500">
                  {hit.category_name} · {hit.unit_name}
                </span>
              </span>
              <span className="shrink-0 text-[11px] font-medium text-emerald-600">＋ creates item</span>
            </button>
          ))}
          {results !== null && results.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-stone-500">
              {q.trim()
                ? 'No matches in your items or the starter library.'
                : 'Type to search the starter library, or add a new item.'}
            </div>
          )}
          {q.trim() !== '' && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick({ kind: 'new', name: q.trim(), category: '', unit: '' }, null)
                setOpen(false)
                setQ('')
              }}
              className="flex w-full items-center gap-2 border-t border-stone-100 px-3 py-2.5 text-left text-[15px] font-medium text-emerald-700 hover:bg-emerald-50"
            >
              ＋ New item “{q.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  )
}
