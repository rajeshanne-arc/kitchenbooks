'use client'

import { useState } from 'react'
import type { Category, VendorHit, VendorSel } from '@/lib/types'
import { decimalStringToPaise, formatPaise } from '@/lib/money'
import { useSearch } from './useSearch'
import { inputCls, selectCls } from './ui'

function CategoryOptions({ categories }: { categories: Category[] }) {
  return (
    <>
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
    </>
  )
}

export default function VendorPicker({
  categories,
  value,
  onChange,
}: {
  categories: Category[]
  value: VendorSel | null
  onChange: (v: VendorSel | null) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const { results, loading } = useSearch<VendorHit>(open ? `/api/vendors/search?q=${encodeURIComponent(q)}` : null)

  if (value?.kind === 'existing') {
    const balP = decimalStringToPaise(value.hit.balance)
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-stone-900">{value.hit.name}</div>
          <div className="text-xs text-stone-500">
            <span className="font-mono">{value.hit.code}</span> · {value.hit.category_name}
            {balP > 0 && <span className="text-amber-700"> · owes {formatPaise(balP)}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null)
            setQ('')
          }}
          aria-label="Change vendor"
          className="shrink-0 rounded-md p-1 text-stone-400 hover:bg-white hover:text-stone-600"
        >
          ✕
        </button>
      </div>
    )
  }

  if (value?.kind === 'new') {
    return (
      <div className="space-y-2.5 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            New vendor — saved with this bill
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Cancel new vendor"
            className="rounded-md p-1 text-stone-400 hover:bg-white hover:text-stone-600"
          >
            ✕
          </button>
        </div>
        <input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="Vendor name"
          className={inputCls}
        />
        <select
          value={value.category}
          onChange={(e) => onChange({ ...value, category: e.target.value })}
          className={selectCls}
        >
          <option value="">Category…</option>
          <CategoryOptions categories={categories} />
        </select>
        <p className="text-xs text-emerald-800/80">
          {value.category ? (
            <>
              Code assigns automatically on save:{' '}
              <span className="font-mono font-medium">V-{value.category}-##</span> (next in series)
            </>
          ) : (
            'The category sets the vendor code series (V-VEG-01, V-VEG-02, …)'
          )}
        </p>
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
        placeholder="Type to find or add a vendor"
        className={inputCls}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg">
          {loading && results === null && <div className="px-3 py-2.5 text-sm text-stone-400">Searching…</div>}
          {results?.map((hit) => {
            const balP = decimalStringToPaise(hit.balance)
            return (
              <button
                key={hit.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange({ kind: 'existing', hit })
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-stone-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] text-stone-900">{hit.name}</span>
                  <span className="block text-xs text-stone-500">
                    <span className="font-mono">{hit.code}</span> · {hit.category_name}
                  </span>
                </span>
                {balP > 0 ? (
                  <span className="shrink-0 text-xs font-medium text-amber-700">owes {formatPaise(balP)}</span>
                ) : (
                  <span className="shrink-0 text-xs text-stone-300">no dues</span>
                )}
              </button>
            )
          })}
          {results !== null && results.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-stone-500">
              {q.trim() ? 'No vendor matches.' : 'No vendors yet — type a name to add your first vendor.'}
            </div>
          )}
          {q.trim() !== '' && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onChange({ kind: 'new', name: q.trim(), category: '' })
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 border-t border-stone-100 px-3 py-2.5 text-left text-[15px] font-medium text-emerald-700 hover:bg-emerald-50"
            >
              ＋ New vendor “{q.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  )
}
