'use client'

// Three-component typeahead: raw items, sub-recipes and dishes in one box.
// Costs never appear here — the save freezes them server-side. Uncostable
// hits are visible but disabled, with the reason on the row.

import { useState } from 'react'
import type { KitchenComponentHit } from '@/lib/types'
import { useSearch } from '@/components/useSearch'
import { inputCls } from '@/components/ui'

const KIND_BADGE: Record<KitchenComponentHit['kind'], { label: string; cls: string }> = {
  item: { label: 'item', cls: 'bg-stone-100 text-stone-600' },
  sub: { label: 'sub', cls: 'bg-sky-100 text-sky-700' },
  dish: { label: 'dish', cls: 'bg-violet-100 text-violet-700' },
}

export default function KitchenComponentPicker({
  value,
  onPick,
  onClear,
  placeholder = 'Search items, subs and dishes',
}: {
  value: KitchenComponentHit | null
  onPick: (hit: KitchenComponentHit) => void
  onClear: () => void
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const { results, loading } = useSearch<KitchenComponentHit>(
    open && q.trim() !== '' ? `/api/kitchen/components?q=${encodeURIComponent(q)}` : null,
  )

  if (value !== null) {
    const badge = KIND_BADGE[value.kind]
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium text-stone-900">{value.name}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          <div className="text-xs text-stone-500">
            <span className="font-mono">{value.code}</span> · per {value.unit_name}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onClear()
            setQ('')
          }}
          aria-label="Change component"
          className="shrink-0 rounded-md p-1 text-stone-400 hover:bg-white hover:text-stone-600"
        >
          ✕
        </button>
      </div>
    )
  }

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
        placeholder={placeholder}
        className={inputCls}
      />
      {open && q.trim() !== '' && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg">
          {loading && results === null && <div className="px-3 py-2.5 text-sm text-stone-400">Searching…</div>}
          {results?.map((hit) => {
            const badge = KIND_BADGE[hit.kind]
            return (
              <button
                key={`${hit.kind}:${hit.id}`}
                type="button"
                disabled={!hit.has_cost}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (!hit.has_cost) return
                  onPick(hit)
                  setOpen(false)
                  setQ('')
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left ${
                  hit.has_cost ? 'hover:bg-stone-50' : 'cursor-not-allowed opacity-50'
                }`}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] text-stone-900">{hit.name}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </span>
                  <span className="block text-xs text-stone-500">
                    <span className="font-mono">{hit.code}</span> · per {hit.unit_name}
                  </span>
                </span>
                {!hit.has_cost && (
                  <span className="shrink-0 text-[11px] font-medium text-amber-700">
                    {hit.kind === 'item' ? 'no cost — bill first' : 'no lines — cost it first'}
                  </span>
                )}
              </button>
            )
          })}
          {results !== null && results.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-stone-500">
              Nothing matches. Components are existing items, subs and dishes — new ones are born on bills and recipe
              cards, never here.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
