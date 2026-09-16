'use client'

// Vendor payment. The screen opens on the AGEING QUEUE — who is OVERDUE,
// oldest first — because that is the question the person walked in with, and
// it is not the question vendor_dues answers. Ranking by balance puts the
// biggest debt on top; ranking by oldest due puts the one that has waited
// longest on top, and on live data those are different vendors.
//
// TAPPING A ROW OPENS IT IN PLACE. Not a sheet and not a modal: he is scanning
// a queue deciding WHO to pay, and a modal takes the list away every time he
// looks at one — so comparing two vendors means opening, closing, opening.
//
// AND IT FETCHES NOTHING. Selecting a vendor used to NAVIGATE, because the
// form needed that vendor's bills and its routing details from the server;
// both now travel with the queue, so an expansion is instant. An expand that
// has to fetch is worse than a link that moves you — it hangs where a link at
// least goes somewhere.
//
// THE ACKNOWLEDGEMENT LIVES HERE, above the queue, because paying a vendor in
// full removes them from `vendor_aging` and the row that held the button is
// gone on the refresh. SaveAck scrolls itself into view, so it is read from
// wherever he was.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { AgingCheck, MoneyAccount, VendorAgingRow, VendorHit } from '@/lib/types'
import { useSearch } from '@/components/useSearch'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { useBusinessToday } from '@/components/BusinessDay'
import Honesty from '@/components/Honesty'
import PayOrAsk, { PayAckView, type PayAck } from '@/components/store/PayOrAsk'
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

export default function PaymentClient({
  modes,
  accounts,
  aging,
  check,
  preopenVendorId = null,
}: {
  modes: string[]
  accounts: MoneyAccount[]
  aging: VendorAgingRow[]
  check: AgingCheck
  /** a bookmarked ?vendor= still opens its row; it no longer navigates */
  preopenVendorId?: string | null
}) {
  const router = useRouter()
  const today = useBusinessToday()
  const [open, setOpen] = useState<string | null>(preopenVendorId)
  const [ack, setAck] = useState<PayAck | null>(null)
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [other, setOther] = useState<{ id: string; name: string } | null>(null)
  const { results, loading } = useSearch<VendorHit>(
    searching && q.trim() !== '' ? `/api/vendors/search?q=${encodeURIComponent(q)}` : null,
  )

  function done(a: PayAck) {
    setAck(a)
    setOpen(null)
    setOther(null)
    router.refresh()
  }

  const noTerms = aging.filter((a) => decimalStringToPaise(a.terms_not_set) > 0)

  return (
    <div className="space-y-4">
      {ack !== null && <PayAckView ack={ack} onDismiss={() => setAck(null)} />}

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Due, oldest first</h2>
          <span className="text-xs text-stone-400">vendor_aging</span>
        </div>

        {/* TWO INDEPENDENT CALCULATIONS THAT MUST AGREE, printed whether they
            do or not — a check that only appears when it fails is a check
            nobody knows is running. vendor_dues is opening + purchased − paid;
            vendor_aging is the FIFO remainder summed over unpaid bills. */}
        {/* AN OVERPAYMENT IS NOT A FAULT AND MUST NOT BLOCK. The alarm is
            reserved for a vendor both views hold and describe differently —
            the only case where the two calculations actually disagree. */}
        {check.disagreeing === 0 && check.missing === 0 ? (
          <p className="mt-1 text-xs text-stone-400">
            Reconciles to vendor_dues · {formatMoneyString(check.aging)} owed across {aging.length} vendors ✓
          </p>
        ) : (
          <div className="mt-2">
            <Honesty level="alarm" verdict="does not reconcile">
              {check.disagreeing > 0 && (
                <>
                  {check.disagreeing} {check.disagreeing === 1 ? 'vendor is' : 'vendors are'} in both the
                  ageing and vendor_dues with different figures.{' '}
                </>
              )}
              {check.missing > 0 && (
                <>
                  {check.missing} {check.missing === 1 ? 'debt appears' : 'debts appear'} in one view and not
                  the other.{' '}
                </>
              )}
              These are two routes to one number and they must match — until they do, do not pay from this
              screen.
            </Honesty>
          </div>
        )}

        {/* THE VENDOR HOLDS OUR MONEY, and nothing else in the app says so:
            vendor_aging drops an overpaid vendor because it filters unpaid > 0,
            and the payment queue is a list of who we owe. */}
        {check.overpaid.length > 0 && (
          <div className="mt-2">
            <Honesty verdict="overpaid">
              {check.overpaid
                .map((o) => `${o.name} by ${formatMoneyString(String(Math.abs(Number(o.balance))))}`)
                .join(' · ')}{' '}
              — a credit, not a debt. They hold our money until the next bill absorbs it, and they are not on
              the queue below because nothing is owed to them.
            </Honesty>
          </div>
        )}

        {aging.length === 0 ? (
          <p className="mt-2 text-sm text-stone-700">
            Nothing is outstanding to any vendor. Search below to pay one anyway — an advance, or a vendor
            whose bill has not been entered yet.
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
                  const isOpen = open === a.vendor_id
                  return (
                    <Row
                      key={a.vendor_id}
                      a={a}
                      overdue={overdue}
                      isOpen={isOpen}
                      onToggle={() => setOpen(isOpen ? null : a.vendor_id)}
                      accounts={accounts}
                      modes={modes}
                      onDone={done}
                    />
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
              outstanding on bills with no payment terms, so nothing can say when it fell due. Set the terms
              on the vendor — Net 7 is weekly, Net 15 is fortnightly.
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
            setSearching(true)
          }}
          placeholder="Search vendors by name or code"
          className={`${inputCls} mt-2`}
        />
        {loading && <p className="mt-1 text-xs text-stone-400">searching…</p>}
        {searching && other === null && results !== null && results.length > 0 && (
          <ul className="mt-2 divide-y divide-rule-soft">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOther({ id: r.id, name: r.name })}
                  className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left hover:bg-stone-50"
                >
                  <span className="truncate text-sm text-stone-900">{r.name}</span>
                  <span className="shrink-0 font-mono text-xs text-stone-400">{r.code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {other !== null && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-stone-900">{other.name}</span>
              <button
                type="button"
                onClick={() => setOther(null)}
                className="text-xs font-medium text-stone-500 hover:text-stone-800"
              >
                change
              </button>
            </div>
            {/* NO AGEING ROW, so no prefilled amount and no bills. This vendor
                is owed nothing on the books — which is exactly why a request
                here needs the advance box ticked, and the server says so. */}
            <PayOrAsk
              vendorId={other.id}
              vendorName={other.name}
              aging={aging.find((a) => a.vendor_id === other.id) ?? null}
              accounts={accounts}
              modes={modes}
              onDone={done}
            />
          </div>
        )}
      </section>
    </div>
  )
}

function Row({
  a,
  overdue,
  isOpen,
  onToggle,
  accounts,
  modes,
  onDone,
}: {
  a: VendorAgingRow
  overdue: boolean
  isOpen: boolean
  onToggle: () => void
  accounts: MoneyAccount[]
  modes: string[]
  onDone: (ack: PayAck) => void
}) {
  return (
    <>
      {/* THE ROW IS THE CONTROL — Rajesh's own words, "if i click on vendor
          name or tab it should expand". An action that lives only in the last
          column is an action that disappears the moment the table is wider
          than its scroller, and that failure is invisible: the markup is
          complete and the button is simply off screen. A row you can hit
          anywhere cannot be clipped out of reach.

          The BUTTON stays, and it is the real control for anybody on a
          keyboard — a <tr> with an onClick is not focusable and does not
          announce itself. The row click is the convenience on top. */}
      <tr
        onClick={onToggle}
        className={`${trCls} cursor-pointer ${isOpen ? 'bg-stone-50' : 'hover:bg-stone-50'}`}
      >
        <td className={tdCls}>
          {/* A NAME IS A DOOR AND A ROW IS A TOGGLE. The vendor's name is the
              one link on the row that must go where it says — their page —
              so it stops the click from also opening the expansion. */}
          <Link
            href={`/store/masters/vendors/${a.vendor_id}`}
            onClick={(e) => e.stopPropagation()}
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
          <button
            type="button"
            onClick={(e) => {
              // The row handles it; without this the click bubbles and the
              // expansion opens and closes in the same gesture.
              e.stopPropagation()
              onToggle()
            }}
            aria-expanded={isOpen}
            className="inline-block min-h-[40px] rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 hover:border-emerald-500"
          >
            {isOpen ? 'Close' : 'Pay'}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={7} className="bg-stone-50 px-3 py-3">
            <PayOrAsk
              vendorId={a.vendor_id}
              vendorName={a.vendor_name}
              aging={a}
              accounts={accounts}
              modes={modes}
              onDone={onDone}
            />
          </td>
        </tr>
      )}
    </>
  )
}
