'use client'

// Vendor payment. The screen opens on the AGEING QUEUE — who is OVERDUE,
// oldest first — because that is the question the person walked in with, and
// it is not the question vendor_dues answers. Ranking by balance puts the
// biggest debt on top; ranking by oldest due puts the one that has waited
// longest on top, and on live data those are different vendors.
//
// SELECTING A VENDOR NAVIGATES rather than setting local state: the form needs
// that vendor's outstanding bills to prefill the amount and say what it is
// made of, and those come from the server.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { AgingCheck, BillOutstandingRow, MoneyAccount, VendorAgingRow, VendorHit } from '@/lib/types'
import { useSearch } from '@/components/useSearch'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { useBusinessToday } from '@/components/BusinessDay'
import Honesty from '@/components/Honesty'
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
import { chipHref } from '@/lib/routes'

export default function PaymentClient({
  modes,
  accounts,
  aging,
  check,
  preselectVendorId = null,
  selectedAging = null,
  selectedBills = [],
}: {
  modes: string[]
  accounts: MoneyAccount[]
  aging: VendorAgingRow[]
  check: AgingCheck
  preselectVendorId?: string | null
  selectedAging?: VendorAgingRow | null
  selectedBills?: BillOutstandingRow[]
}) {
  const router = useRouter()
  const today = useBusinessToday()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const { results, loading } = useSearch<VendorHit>(
    open && q.trim() !== '' ? `/api/vendors/search?q=${encodeURIComponent(q)}` : null,
  )

  const name = selectedAging?.vendor_name ?? aging.find((a) => a.vendor_id === preselectVendorId)?.vendor_name ?? null

  if (preselectVendorId !== null) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rule bg-cell p-4">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-stone-900">{name ?? 'Vendor'}</div>
            {selectedAging !== null && (
              <div className="text-xs text-stone-500">
                <span className="font-mono">{selectedAging.vendor_code}</span>
                {selectedAging.oldest_due !== null && <> · oldest due {fmtDate(selectedAging.oldest_due)}</>}
              </div>
            )}
          </div>
          <Link
            href={chipHref('store', 'purchasing', 'pay')}
            className="min-h-[40px] shrink-0 rounded-lg border border-rule px-2.5 py-2 text-xs font-medium text-stone-600 hover:border-stone-400"
          >
            change vendor
          </Link>
        </div>
        <PaymentForm
          vendorId={preselectVendorId}
          vendorName={name ?? 'this vendor'}
          modes={modes}
          accounts={accounts}
          aging={selectedAging}
          bills={selectedBills}
        />
        <Link
          href={`/store/masters/vendors/${preselectVendorId}`}
          className="block text-center text-sm font-medium text-emerald-700 hover:underline"
        >
          Vendor page — bank details, bills and payment history →
        </Link>
      </div>
    )
  }

  const noTerms = aging.filter((a) => decimalStringToPaise(a.terms_not_set) > 0)

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Due, oldest first</h2>
          <span className="text-xs text-stone-400">vendor_aging</span>
        </div>

        {/* TWO INDEPENDENT CALCULATIONS THAT MUST AGREE, printed whether they
            do or not — a check that only appears when it fails is a check
            nobody knows is running. vendor_dues is opening + purchased − paid;
            vendor_aging is the FIFO remainder summed over unpaid bills. They
            reach the same number by different routes, which is the whole
            reason the ageing is worth trusting. */}
        {/* AN OVERPAYMENT IS NOT A FAULT AND MUST NOT BLOCK. The alarm is
            reserved for a vendor both views hold that they describe
            differently — the only case where the two calculations actually
            disagree. A vendor who is overpaid legitimately appears in one view
            and not the other, and stopping all paying because of one would be
            the check refusing the work it exists to protect. */}
        {check.disagreeing === 0 && check.missing === 0 ? (
          <p className="mt-1 text-xs text-stone-400">
            Reconciles to vendor_dues · {formatMoneyString(check.aging)} owed across {aging.length} vendors ✓
          </p>
        ) : (
          <div className="mt-2">
            <Honesty level="alarm" verdict="does not reconcile">
              {check.disagreeing > 0 && (
                <>
                  {check.disagreeing} {check.disagreeing === 1 ? 'vendor is' : 'vendors are'} in both the ageing and
                  vendor_dues with different figures.{' '}
                </>
              )}
              {check.missing > 0 && (
                <>
                  {check.missing} {check.missing === 1 ? 'debt appears' : 'debts appear'} in one view and not the
                  other.{' '}
                </>
              )}
              These are two routes to one number and they must match — until they do, do not pay from this screen.
            </Honesty>
          </div>
        )}

        {/* THE VENDOR HOLDS OUR MONEY, and nothing else in the app says so.
            Today it is 61 paise; a mis-keyed payment makes it ₹50,000 and it
            would surface nowhere — vendor_aging drops an overpaid vendor
            because it filters unpaid > 0, and the payment queue is a list of
            who we owe. */}
        {check.overpaid.length > 0 && (
          <div className="mt-2">
            <Honesty verdict="overpaid">
              {check.overpaid
                .map((o) => `${o.name} by ${formatMoneyString(String(Math.abs(Number(o.balance))))}`)
                .join(' · ')}{' '}
              — a credit, not a debt. They hold our money until the next bill absorbs it, and they are not on the
              queue below because nothing is owed to them.
            </Honesty>
          </div>
        )}

        {aging.length === 0 ? (
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
                  <th className={thCls}>Oldest due</th>
                  <th className={thNumCls}>Bills</th>
                  <th className={thNumCls}>Outstanding</th>
                  <th className={thCls}>
                    <span className="sr-only">Pay</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {aging.map((a) => {
                  // OVERDUE IS A FACT ABOUT TODAY, compared against the app's
                  // own business day. The view deliberately carries no "today"
                  // of its own: business_date() reads settings without a
                  // tenant argument, and a view correct only while RLS happens
                  // to be filtering it has no correctness of its own.
                  const overdue = a.oldest_due !== null && a.oldest_due < today
                  return (
                    <tr key={a.vendor_id} className={trCls}>
                      <td className={tdCls}>
                        <Link
                          href={`/store/masters/vendors/${a.vendor_id}`}
                          className="font-medium hover:text-emerald-700 hover:underline"
                        >
                          {a.vendor_name}
                        </Link>
                      </td>
                      <td className={tdCodeCls}>{a.vendor_code}</td>
                      <td className={`${tdCls} text-stone-500`}>
                        {a.payment_terms ?? <span className="text-amber-800">not set</span>}
                      </td>
                      <td className={tdCls}>
                        {a.oldest_due === null ? (
                          <span className="text-xs text-amber-800">no due date</span>
                        ) : (
                          <span className={overdue ? 'font-semibold text-red-700' : 'text-stone-600'}>
                            {fmtDate(a.oldest_due)}
                          </span>
                        )}
                      </td>
                      <td className={tdNumCls}>{a.open_bills}</td>
                      <td className={`${tdNumCls} font-semibold`}>{formatMoneyString(a.outstanding)}</td>
                      <td className={tdCls}>
                        <Link
                          href={`${chipHref('store', 'purchasing', 'pay')}?vendor=${a.vendor_id}`}
                          className="inline-block min-h-[40px] rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 hover:border-emerald-500"
                        >
                          Pay
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* SAY IT RATHER THAN ASSUME A DEFAULT. A due date nobody agreed to is
            worse than none, so a vendor without terms shows no due date and is
            named here instead of being given one. */}
        {noTerms.length > 0 && (
          <div className="mt-3">
            <Honesty
              verdict="no payment terms"
              meter={{ filled: aging.length - noTerms.length, total: aging.length, unit: 'vendors' }}
            >
              {noTerms.map((a) => a.vendor_name).join(' · ')} {noTerms.length === 1 ? 'has' : 'have'} money
              outstanding on bills with no payment terms, so nothing can say when it fell due. Set the terms on the
              vendor — Net 7 is weekly, Net 15 is fortnightly.
            </Honesty>
          </div>
        )}
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Someone else</h2>
        <p className="mt-1 text-xs text-stone-500">
          For a vendor who is owed nothing — an advance, or a first payment.
        </p>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          placeholder="Search vendors by name or code"
          className={`${inputCls} mt-2`}
        />
        {loading && <p className="mt-1 text-xs text-stone-400">searching…</p>}
        {open && results !== null && results.length > 0 && (
          <ul className="mt-2 divide-y divide-rule-soft">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => router.push(`${chipHref('store', 'purchasing', 'pay')}?vendor=${r.id}`)}
                  className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left hover:bg-stone-50"
                >
                  <span className="truncate text-sm text-stone-900">{r.name}</span>
                  <span className="shrink-0 font-mono text-xs text-stone-400">{r.code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
