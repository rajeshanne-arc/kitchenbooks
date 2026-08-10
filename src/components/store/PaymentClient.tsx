'use client'

// Standalone vendor payment (phase 14): pick the vendor, see their dues
// live, record the payment. Same recordPayment action the bill pages use;
// modes come from the payment_mode list. Payment sits with the store for
// now — the accountant handoff comes later.

import { useState } from 'react'
import Link from 'next/link'
import type { VendorHit } from '@/lib/types'
import { useSearch } from '@/components/useSearch'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { inputCls } from '@/components/ui'
import PaymentForm from '@/components/books/PaymentForm'

export default function PaymentClient({ modes }: { modes: string[] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [vendor, setVendor] = useState<VendorHit | null>(null)
  const { results, loading } = useSearch<VendorHit>(
    open && q.trim() !== '' ? `/api/vendors/search?q=${encodeURIComponent(q)}` : null,
  )

  if (vendor !== null) {
    const bal = decimalStringToPaise(vendor.balance)
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-stone-900">{vendor.name}</div>
            <div className="text-xs text-stone-500">
              <span className="font-mono">{vendor.code}</span> · dues{' '}
              <span className={`font-semibold tabular-nums ${bal > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {formatMoneyString(vendor.balance)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setVendor(null)
              setQ('')
            }}
            className="shrink-0 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-stone-500 hover:border-stone-300"
          >
            change vendor
          </button>
        </div>
        <PaymentForm vendorId={vendor.id} vendorName={vendor.name} modes={modes} />
        <Link
          href={`/books/vendors/${vendor.id}`}
          className="block text-center text-sm font-medium text-emerald-700 hover:underline"
        >
          Vendor page — bills and payment history →
        </Link>
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
        placeholder="Vendor — search by name"
        className={inputCls}
      />
      {open && q.trim() !== '' && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg">
          {loading && results === null && <div className="px-3 py-2.5 text-sm text-stone-400">Searching…</div>}
          {results?.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                setVendor(hit)
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
              <span className="shrink-0 tabular-nums text-sm font-semibold text-stone-700">
                {formatMoneyString(hit.balance)}
              </span>
            </button>
          ))}
          {results !== null && results.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-stone-500">
              No vendor matches. Vendors are born on bills — or add one from the Vendors tab.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
