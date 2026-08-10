'use client'

// Typeahead over items ∪ existing sub-recipes. Uncosted items are pickable —
// the recipe views carry an honesty column for them — but they are labeled.

import { useState } from 'react'
import type { ComponentHit } from '@/lib/types'
import { useSearch } from '@/components/useSearch'
import { inputCls } from '@/components/ui'

const headingCls = 'px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400'

export default function ComponentPicker({
  excludeRecipeId,
  value,
  onPick,
  onClear,
}: {
  excludeRecipeId: string
  value: ComponentHit | null
  onPick: (hit: ComponentHit) => void
  onClear: () => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const { results, loading } = useSearch<ComponentHit>(
    open ? `/api/recipes/components?exclude=${excludeRecipeId}&q=${encodeURIComponent(q)}` : null,
  )

  if (value !== null) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium text-stone-900">{value.name}</span>
            {value.kind === 'sub' && (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700">
                sub
              </span>
            )}
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

  const items = (results ?? []).filter((h) => h.kind === 'item')
  const subs = (results ?? []).filter((h) => h.kind === 'sub')

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
        placeholder="Ingredient — item or sub-recipe"
        className={inputCls}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg">
          {loading && results === null && <div className="px-3 py-2.5 text-sm text-stone-400">Searching…</div>}
          {items.length > 0 && <div className={headingCls}>Items</div>}
          {items.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(hit)
                setOpen(false)
                setQ('')
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-stone-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] text-stone-900">{hit.name}</span>
                <span className="block text-xs text-stone-500">
                  <span className="font-mono">{hit.code}</span> · {hit.category_name} · per {hit.unit_name}
                </span>
              </span>
              {hit.kind === 'item' && !hit.has_cost && (
                <span className="shrink-0 text-[11px] font-medium text-amber-700">no cost yet</span>
              )}
            </button>
          ))}
          {subs.length > 0 && <div className={headingCls}>Sub-recipes</div>}
          {subs.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(hit)
                setOpen(false)
                setQ('')
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-stone-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] text-stone-900">{hit.name}</span>
                <span className="block text-xs text-stone-500">
                  <span className="font-mono">{hit.code}</span> · per {hit.unit_name}
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700">
                sub
              </span>
            </button>
          ))}
          {results !== null && results.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-stone-500">
              {q.trim() === ''
                ? 'Type to search items and sub-recipes.'
                : 'No match. Items must be purchased before they can be costed — enter the bill first.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
