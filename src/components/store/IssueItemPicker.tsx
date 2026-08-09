'use client'

// Typeahead over EXISTING items only — an issue or wastage entry cannot
// invent an item. Costs never appear here; on-hand quantity does.

import { useState } from 'react'
import type { IssuableItemHit } from '@/lib/types'
import { useSearch } from '@/components/useSearch'
import { inputCls } from '@/components/ui'

export default function IssueItemPicker({
  value,
  onPick,
  onClear,
}: {
  value: IssuableItemHit | null
  onPick: (hit: IssuableItemHit) => void
  onClear: () => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const { results, loading } = useSearch<IssuableItemHit>(
    open ? `/api/items/issuable?q=${encodeURIComponent(q)}` : null,
  )

  if (value !== null) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-stone-900">{value.name}</div>
          <div className="text-xs text-stone-500">
            <span className="font-mono">{value.code}</span> · {value.on_hand_qty} {value.purchase_unit} on hand
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
        placeholder="Item — search purchased items"
        className={inputCls}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg">
          {loading && results === null && <div className="px-3 py-2.5 text-sm text-stone-400">Searching…</div>}
          {results?.map((hit) => (
            <button
              key={hit.id}
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
                <span className="block truncate text-[15px] text-stone-900">{hit.name}</span>
                <span className="block text-xs text-stone-500">
                  <span className="font-mono">{hit.code}</span> · {hit.category_name} · {hit.on_hand_qty}{' '}
                  {hit.purchase_unit} on hand
                </span>
              </span>
              {!hit.has_cost && (
                <span className="shrink-0 text-[11px] font-medium text-amber-700">no cost — bill first</span>
              )}
            </button>
          ))}
          {results !== null && results.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-stone-500">
              {q.trim() === ''
                ? 'Type to search purchased items.'
                : 'No purchased item matches. Items are born on bills — if it’s new, enter the bill first; an issue can’t invent an item.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
