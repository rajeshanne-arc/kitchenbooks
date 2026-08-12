'use client'

// Vendor payment. The screen opens on the DUES QUEUE — who is owed, worst
// first, and how long since they were last paid — because that is the
// question the person walked in with. Search stays available underneath for
// the vendor who is owed nothing (an advance, a first payment).
//
// modes come from the payment_mode list and are passed all the way down;
// there is no hardcoded fallback anywhere in this path.

import { useState } from 'react'
import Link from 'next/link'
import type { MoneyAccount, VendorDueRow, VendorHit } from '@/lib/types'
import { useSearch } from '@/components/useSearch'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import {
  cardCls,
  dataTableCls,
  inputCls,
  sectionHeadCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import PaymentForm from '@/components/books/PaymentForm'

/** A due row and a search hit carry the same few fields the form needs. */
const fromDue = (d: VendorDueRow): VendorHit => ({
  id: d.id,
  code: d.code,
  name: d.name,
  primary_category: '',
  category_name: d.category_name,
  balance: d.balance,
})

export default function PaymentClient({
  modes,
  accounts,
  dues,
  preselectVendorId = null,
}: {
  modes: string[]
  accounts: MoneyAccount[]
  dues: VendorDueRow[]
  preselectVendorId?: string | null
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [vendor, setVendor] = useState<VendorHit | null>(() => {
    if (preselectVendorId === null) return null
    const hit = dues.find((d) => d.id === preselectVendorId)
    return hit === undefined ? null : fromDue(hit)
  })
  const { results, loading } = useSearch<VendorHit>(
    open && q.trim() !== '' ? `/api/vendors/search?q=${encodeURIComponent(q)}` : null,
  )

  if (vendor !== null) {
    const bal = decimalStringToPaise(vendor.balance)
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rule bg-cell p-4">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-stone-900">{vendor.name}</div>
            <div className="text-xs text-stone-500">
              <span className="font-mono">{vendor.code}</span> · dues{' '}
              <span
                className={`font-mono font-semibold tabular-nums ${bal > 0 ? 'text-amber-800' : 'text-emerald-700'}`}
              >
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
            className="min-h-[40px] shrink-0 rounded-lg border border-rule px-2.5 text-xs font-medium text-stone-600 hover:border-stone-400"
          >
            change vendor
          </button>
        </div>
        <PaymentForm vendorId={vendor.id} vendorName={vendor.name} modes={modes} accounts={accounts} />
        <Link
          href={`/store/masters/vendors/${vendor.id}`}
          className="block text-center text-sm font-medium text-emerald-700 hover:underline"
        >
          Vendor page — bank details, bills and payment history →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Owed right now</h2>
          <span className="text-xs text-stone-400">vendor_dues</span>
        </div>

        {dues.length === 0 ? (
          <p className="mt-2 text-sm text-stone-700">
            Nothing is outstanding to any vendor. Search below to pay one anyway — an advance, or a vendor whose
            bill has not been entered yet.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Vendor</th>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Terms</th>
                  <th className={thNumCls}>Last paid</th>
                  <th className={thNumCls}>Balance</th>
                  <th className={thCls}>
                    <span className="sr-only">Pay</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dues.map((d) => {
                  const bal = decimalStringToPaise(d.balance)
                  const stale = d.days_since_payment !== null && d.days_since_payment > 30
                  return (
                    <tr key={d.id} className={trCls}>
                      <td className={tdCls}>
                        <Link
                          href={`/store/masters/vendors/${d.id}`}
                          className="font-medium hover:text-emerald-700 hover:underline"
                        >
                          {d.name}
                        </Link>
                      </td>
                      <td className={tdCodeCls}>{d.code}</td>
                      <td className={`${tdCls} text-stone-500`}>{d.payment_terms ?? '—'}</td>
                      <td className={tdNumCls}>
                        {d.days_since_payment === null ? (
                          <span className="font-sans text-xs text-amber-800">never paid</span>
                        ) : (
                          <span className={stale ? 'font-semibold text-amber-800' : 'text-stone-600'}>
                            {d.days_since_payment}d
                            {d.last_paid_date !== null && (
                              <span className="ml-1 font-sans text-[11px] text-stone-400">
                                {fmtDate(d.last_paid_date)}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td
                        className={`${tdNumCls} font-semibold ${bal < 0 ? 'text-emerald-700' : 'text-stone-900'}`}
                      >
                        {formatMoneyString(d.balance)}
                      </td>
                      <td className={`${tdCls} text-right`}>
                        <button
                          type="button"
                          onClick={() => setVendor(fromDue(d))}
                          className="min-h-[40px] rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800"
                        >
                          Pay
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Someone else</h2>
        <div className="relative mt-2">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Vendor — search by name or code"
            className={inputCls}
          />
          {open && q.trim() !== '' && (
            <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-rule bg-cell shadow-lg">
              {loading && results === null && (
                <div className="px-3 py-2.5 text-sm text-stone-400">Searching…</div>
              )}
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
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-stone-700">
                    {formatMoneyString(hit.balance)}
                  </span>
                </button>
              ))}
              {results !== null && results.length === 0 && (
                <div className="px-3 py-2.5 text-sm text-stone-500">
                  No vendor matches. Vendors are born on bills — or add one from the Masters tab.
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
