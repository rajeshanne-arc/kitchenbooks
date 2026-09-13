import Link from 'next/link'
import { Suspense } from 'react'
import FilterInput from '@/components/books/FilterInput'
import { StatusBadge } from '@/components/books/Badges'
import ShowClosed from '@/components/books/ShowClosed'
import { getRestaurant } from '@/server/queries'
import { listVendors } from '@/server/books-queries'
import { countVendorsUnpayable } from '@/server/approvals-queries'
import Honesty from '@/components/Honesty'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ q?: string; closed?: string }> }) {
  const { q = '', closed } = await searchParams
  const showClosed = closed === '1'
  const restaurant = await getRestaurant()
  const [vendors, pay] = await Promise.all([
    listVendors(restaurant.id, q.slice(0, 60), showClosed),
    countVendorsUnpayable(restaurant.id),
  ])

  return (
    <section>
      <div className="mt-3 flex items-center justify-end">
        <Link
          href="/store/masters/vendors/new"
          className="rounded-lg border border-emerald-700 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
        >
          ＋ Add vendor
        </Link>
      </div>
      <Suspense>
        <FilterInput placeholder="Filter vendors by name or code" />
      </Suspense>
      <Suspense>
        <ShowClosed on={showClosed} searching={q !== ''} noun="vendors" />
      </Suspense>

      {/* WHO CAN ACTUALLY BE PAID. COMPUTED, NEVER ASSERTED — it clears itself
          as the details arrive, the same shape as the purchase-order phone
          blocker. A vendor with no account number and no UPI id can be paid in
          cash or by cheque and by nothing else, and that is discovered today
          at the moment somebody is trying to send them money.

          The UPI half is the sharper one: not one vendor carries a UPI id, so
          the mode cannot be offered on a single payment — and it IS an active
          row in the payment_mode list, which means it was being offered on
          every one. An option that cannot be taken is worse than a missing
          one, because somebody picks it and finds out afterwards. */}
      {pay.unpayable > 0 && (
        <div className="mt-3">
          <Honesty
            verdict="nowhere to send it"
            meter={{ filled: pay.total - pay.unpayable, total: pay.total, unit: 'vendors' }}
          >
            {pay.unpayable} of {pay.total} active vendors have neither an account number nor a UPI id, so
            no transfer can be made to them — cash or a cheque only, and somebody has to ask them for the
            details before a bill falls due.
            {pay.withUpi === 0 && (
              <>
                {' '}
                Not one vendor has a UPI id at all, so UPI is offered on no payment anywhere in the app
                rather than shown as a choice that would fail.
              </>
            )}
          </Honesty>
        </div>
      )}
      {vendors.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
          {q !== '' ? (
            <p className="text-sm text-stone-500">No vendor matches “{q}”.</p>
          ) : (
            <>
              <p className="text-lg font-semibold text-stone-900">No vendors yet.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
                Vendors are born inside the bill flow — enter a bill from a new supplier and they appear here, code and
                all.
              </p>
              <Link
                href="/store/purchasing/receive"
                className="mt-5 inline-block rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Enter a bill
              </Link>
            </>
          )}
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-rule-soft">
          {vendors.map((v) => {
            const balP = decimalStringToPaise(v.balance)
            return (
              <li key={v.id}>
                <Link
                  href={`/store/masters/vendors/${v.id}`}
                  className={`flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-stone-50 ${
                    v.status === 'inactive' ? 'opacity-60' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[15px] font-medium text-stone-900">{v.name}</span>
                      <StatusBadge status={v.status} />
                    </span>
                    <span className="mt-0.5 block text-xs text-stone-500">
                      <span className="font-mono">{v.code}</span> · {v.category_name}
                      {/* SAID ON THE LIST, not discovered at the send button.
                          A vendor with no number can be billed and paid like
                          any other — the one thing that cannot happen is an
                          order going out to them. */}
                      {v.phone === null && v.status === 'active' && (
                        <span className="ml-1.5 font-medium text-red-700">no phone — cannot be sent an order</span>
                      )}
                    </span>
                  </span>
                  {balP > 0 ? (
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-amber-700">
                      owes {formatMoneyString(v.balance)}
                    </span>
                  ) : balP < 0 ? (
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-700">
                      advance {formatMoneyString(v.balance)}
                    </span>
                  ) : (
                    <span className="shrink-0 text-sm text-stone-300">settled</span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
