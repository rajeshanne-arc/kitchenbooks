'use client'

import Link from 'next/link'
import type { SavedBill } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-stone-500">{label}</dt>
      <dd className="font-medium tabular-nums text-stone-900">{value}</dd>
    </div>
  )
}

export default function SaveReveal({ saved, onAgain }: { saved: SavedBill; onAgain: () => void }) {
  const { purchase, vendor, createdItems, dues } = saved
  const createdSomething = vendor.created || createdItems.length > 0
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 sm:px-6">
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
            <svg className="h-5 w-5 text-emerald-700" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M4 10.5 8.5 15 16 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h2 className="text-lg font-bold text-stone-900">Bill saved</h2>
            <p className="text-sm text-stone-500">
              {fmtDate(purchase.billDate)} · {vendor.name} · {purchase.lineCount}{' '}
              {purchase.lineCount === 1 ? 'line' : 'lines'}
            </p>
          </div>
        </div>
        <dl className="mt-4 space-y-1.5 border-t border-stone-100 pt-4 text-sm">
          <Row label="Goods" value={formatMoneyString(purchase.goodsTotal)} />
          {decimalStringToPaise(purchase.gstTotal) !== 0 && <Row label="GST" value={formatMoneyString(purchase.gstTotal)} />}
          {decimalStringToPaise(purchase.transport) !== 0 && (
            <Row label="Transport" value={formatMoneyString(purchase.transport)} />
          )}
          <div className="flex items-center justify-between border-t border-stone-100 pt-2.5">
            <dt className="font-medium text-stone-500">Bill total</dt>
            <dd className="text-2xl font-bold tabular-nums tracking-tight text-stone-900">
              {formatMoneyString(purchase.billTotal)}
            </dd>
          </div>
        </dl>
      </section>

      {createdSomething && (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">Created with this bill</h3>
          <ul className="mt-3 space-y-2">
            {vendor.created && (
              <li className="flex items-center gap-2.5">
                <code className="rounded bg-stone-900 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white">
                  {vendor.code}
                </code>
                <span className="min-w-0 truncate text-[15px] text-stone-900">{vendor.name}</span>
                <span className="shrink-0 text-xs text-stone-400">new vendor</span>
              </li>
            )}
            {createdItems.map((it) => (
              <li key={it.id} className="flex items-center gap-2.5">
                <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-700">
                  {it.code}
                </code>
                <span className="min-w-0 truncate text-[15px] text-stone-900">{it.name}</span>
                <span className="shrink-0 text-xs text-stone-400">new item</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-emerald-800">Vendor dues</h3>
        <p className="mt-1.5 text-[15px] text-stone-900">
          {vendor.name} is now owed{' '}
          <span className="text-2xl font-bold tabular-nums tracking-tight">{formatMoneyString(dues.balance)}</span>
        </p>
        <p className="mt-1 text-xs text-stone-500">
          purchased {formatMoneyString(dues.purchased)} − paid {formatMoneyString(dues.paid)} · read live from vendor_dues
        </p>
      </section>

      <button
        type="button"
        onClick={onAgain}
        className="w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800"
      >
        Enter another bill
      </button>
      <Link
        href={`/books/bills/${purchase.id}`}
        className="block text-center text-sm font-medium text-emerald-700 hover:underline"
      >
        See it in Books →
      </Link>
    </div>
  )
}
