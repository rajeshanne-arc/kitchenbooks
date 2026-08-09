import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getVendorBills, getVendorDetail, getVendorPayments } from '@/server/books-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { RetiredBadge } from '@/components/books/Badges'
import BillList from '@/components/books/BillList'
import PaymentForm from '@/components/books/PaymentForm'
import VendorEdit from '@/components/books/VendorEdit'
import { cardCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const vendor = await getVendorDetail(restaurant.id, id)
  if (!vendor) notFound()

  const [bills, payments] = await Promise.all([getVendorBills(restaurant.id, id), getVendorPayments(id)])
  const balP = decimalStringToPaise(vendor.balance)

  return (
    <div className="mt-4 space-y-4">
      <Link href="/books/vendors" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Vendors
      </Link>

      <section className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-stone-900">{vendor.name}</h2>
              {vendor.status === 'inactive' && <RetiredBadge />}
            </div>
            <p className="mt-0.5 text-sm text-stone-500">
              <span className="font-mono">{vendor.code}</span> · {vendor.category_name}
            </p>
            {vendor.supplies.length > 0 && (
              <p className="mt-1.5 flex flex-wrap gap-1.5">
                {vendor.supplies.map((s) => (
                  <span key={s} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                    {s}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
              {balP >= 0 ? 'Owed to vendor' : 'Vendor holds advance'}
            </div>
            <div
              className={`text-3xl font-bold tabular-nums tracking-tight ${
                balP > 0 ? 'text-stone-900' : balP < 0 ? 'text-emerald-700' : 'text-stone-400'
              }`}
            >
              {formatMoneyString(vendor.balance)}
            </div>
            <div className="mt-0.5 text-xs text-stone-500">
              purchased {formatMoneyString(vendor.purchased)} − paid {formatMoneyString(vendor.paid)} · vendor_dues
            </div>
          </div>
        </div>
      </section>

      <PaymentForm vendorId={vendor.id} vendorName={vendor.name} />

      <VendorEdit vendor={vendor} />

      {payments.length > 0 && (
        <section className={cardCls}>
          <h3 className={sectionHeadCls}>Payments</h3>
          <ul className="mt-1 divide-y divide-stone-100">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[15px] text-stone-900">{fmtDate(p.paid_date)}</div>
                  <div className="mt-0.5 text-xs text-stone-500">
                    {p.mode ?? '—'}
                    {p.note !== null && <> · {p.note}</>}
                  </div>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-emerald-700">
                  −{formatMoneyString(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={cardCls}>
        <h3 className={sectionHeadCls}>Bill history</h3>
        {bills.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            No bills yet — the first purchase from {vendor.name} will appear here.
          </p>
        ) : (
          <div className="mt-1">
            <BillList bills={bills} showVendor={false} />
          </div>
        )}
      </section>
    </div>
  )
}
