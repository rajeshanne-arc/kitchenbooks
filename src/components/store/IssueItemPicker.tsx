'use client'

// Typeahead over EXISTING items only — an issue or wastage entry cannot
// invent an item. Costs never appear here; on-hand quantity does.
//
// THE PICKER PRINCIPLE, and this component is where it lives:
//
//   A picker WITH context is SCOPED AND RANKED by that context.
//   A picker WITHOUT context is ranked by frequency.
//   SCOPING NEVER EXCLUDES.
//
// So `suggestions` — what this department takes, what this vendor supplies —
// render as a named group at the TOP, and the general search stays underneath
// reaching every item. Without the second half a first-time item becomes
// unfindable: a department taking chillies for the first time, a vendor
// sending something they have never sent. That is the same shape bill entry
// already uses for the starter library.
//
// The suggestions are ranked BY THE SERVER, which is where the frequency and
// recency live. This component never re-sorts them; it only narrows them by
// what has been typed, so the order the query argued for survives.

import { useState } from 'react'
import type { IssuableItemHit, ItemSuggestion } from '@/lib/types'
import { useSearch } from '@/components/useSearch'
import { formatMoneyString } from '@/lib/money'
import { inputCls } from '@/components/ui'

const SUGGEST_CAP = 8

export default function IssueItemPicker({
  value,
  onPick,
  onClear,
  suggestions = [],
  suggestLabel,
}: {
  value: IssuableItemHit | null
  /** the suggestion is handed back when one was tapped, so the caller can take
   *  the rate or the typical quantity from it. A plain search hit carries
   *  neither, and the caller must not invent them. */
  onPick: (hit: IssuableItemHit, suggestion?: ItemSuggestion) => void
  onClear: () => void
  /** scoped and ranked by the context the form already knows */
  suggestions?: ItemSuggestion[]
  /** names the scope in the user's own words — "Chinese usually takes" */
  suggestLabel?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const { results, loading } = useSearch<IssuableItemHit>(
    open ? `/api/items/issuable?q=${encodeURIComponent(q)}` : null,
  )

  const needle = q.trim().toLowerCase()
  const shownSuggestions = suggestions
    .filter(
      (s) =>
        needle === '' ||
        s.item.name.toLowerCase().includes(needle) ||
        s.item.code.toLowerCase().includes(needle),
    )
    .slice(0, SUGGEST_CAP)
  // Everything else, minus what is already above it — the same item twice in
  // one list makes the reader wonder which one is different.
  const above = new Set(shownSuggestions.map((s) => s.item.id))
  const rest = (results ?? []).filter((r) => !above.has(r.id))

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

  const pick = (hit: IssuableItemHit, suggestion?: ItemSuggestion) => {
    if (!hit.has_cost) return
    onPick(hit, suggestion)
    setOpen(false)
    setQ('')
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
        placeholder={suggestions.length > 0 ? 'Item — tap one, or search' : 'Item — search purchased items'}
        className={inputCls}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg">
          {shownSuggestions.length > 0 && (
            <>
              <div className="border-b border-rule-soft bg-stone-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                {suggestLabel ?? 'Usually taken'}
              </div>
              {shownSuggestions.map((s) => (
                <button
                  key={`s-${s.item.id}`}
                  type="button"
                  disabled={!s.item.has_cost}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(s.item, s)
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left ${
                    s.item.has_cost ? 'hover:bg-emerald-50/60' : 'cursor-not-allowed opacity-50'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] text-stone-900">{s.item.name}</span>
                    <span className="block text-xs text-stone-500">
                      <span className="font-mono">{s.item.code}</span> · {s.item.on_hand_qty}{' '}
                      {s.item.purchase_unit} on hand
                    </span>
                  </span>
                  {/* What the context knows, stated rather than acted on. The
                      typical quantity is a HINT — it is never written into the
                      box, because a quantity nobody counted looks exactly
                      like one somebody did. */}
                  <span className="shrink-0 text-right text-[11px] leading-tight text-stone-500">
                    {s.last_rate !== null && (
                      <span className="block font-mono tabular-nums text-stone-600">
                        last {formatMoneyString(s.last_rate)}/{s.item.purchase_unit}
                      </span>
                    )}
                    {s.typical_qty !== null && (
                      <span className="block font-mono tabular-nums">
                        usually {s.typical_qty} {s.item.purchase_unit}
                      </span>
                    )}
                    <span className="block">
                      {s.times}× · {s.last}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}

          {/* EVERYTHING ELSE, always reachable. This header exists only when
              there is a group above it to distinguish from. */}
          {shownSuggestions.length > 0 && rest.length > 0 && (
            <div className="border-y border-rule-soft bg-stone-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
              Everything else
            </div>
          )}
          {loading && results === null && <div className="px-3 py-2.5 text-sm text-stone-400">Searching…</div>}
          {rest.map((hit) => (
            <button
              key={hit.id}
              type="button"
              disabled={!hit.has_cost}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(hit)
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
          {results !== null && rest.length === 0 && shownSuggestions.length === 0 && (
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
