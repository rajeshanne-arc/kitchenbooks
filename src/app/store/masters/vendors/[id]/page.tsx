import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getVendorBills, getVendorDetail, getVendorPayments } from '@/server/books-queries'
import { getList } from '@/server/settings'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { RetiredBadge } from '@/components/books/Badges'
import BillList from '@/components/books/BillList'
import CopyField from '@/components/books/CopyField'
import PaymentForm from '@/components/books/PaymentForm'
import VendorEdit from '@/components/books/VendorEdit'
import {
  cardCls,
  dataTableCls,
  heroNumCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

// The vendor profile. Ordered by what someone actually came here to do:
// see what is owed, get the bank details right, call them, pay them — and
// only then edit the master.

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const vendor = await getVendorDetail(restaurant.id, id)
  if (!vendor) notFound()

  const [bills, payments, modes] = await Promise.all([
    getVendorBills(restaurant.id, id),
    getVendorPayments(id),
    getList(restaurant.id, 'payment_mode'),
  ])
  const balP = decimalStringToPaise(vendor.balance)
  const hasBank =
    vendor.bank_name !== null || vendor.account_no !== null || vendor.ifsc !== null || vendor.upi_id !== null
  const hasContact =
    vendor.contact_person !== null ||
    vendor.phone !== null ||
    vendor.alt_phone !== null ||
    vendor.email !== null ||
    vendor.address !== null

  return (
    <div className="mt-4 space-y-4">
      <Link
        href="/store/masters/vendors"
        className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800"
      >
        ← Vendors
      </Link>

      {/* header — who they are and what we owe */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-stone-900">{vendor.name}</h2>
              {vendor.status === 'inactive' && <RetiredBadge />}
            </div>
            <p className="mt-0.5 text-sm text-stone-500">
              <span className="font-mono">{vendor.code}</span> · {vendor.category_name}
              {vendor.payment_terms !== null && <> · {vendor.payment_terms}</>}
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
              className={`text-3xl ${heroNumCls} ${
                balP > 0 ? 'text-stone-900' : balP < 0 ? 'text-emerald-700' : 'text-stone-400'
              }`}
            >
              {formatMoneyString(vendor.balance)}
            </div>
            <div className="mt-0.5 text-xs text-stone-500">
              opening {formatMoneyString(vendor.opening_balance)} + purchased{' '}
              {formatMoneyString(vendor.purchased)} − paid {formatMoneyString(vendor.paid)}
              <span className="text-stone-400"> · vendor_dues</span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* banking — the copy-me card */}
        <section className={cardCls}>
          <h3 className={sectionHeadCls}>Banking</h3>
          {hasBank ? (
            <div className="mt-1">
              {vendor.bank_name !== null && <CopyField label="Bank" value={vendor.bank_name} />}
              {vendor.account_no !== null && (
                <CopyField label="Account number" value={vendor.account_no} group />
              )}
              {vendor.ifsc !== null && <CopyField label="IFSC" value={vendor.ifsc} />}
              {vendor.upi_id !== null && <CopyField label="UPI ID" value={vendor.upi_id} />}
            </div>
          ) : (
            <p className="mt-2 text-sm text-stone-500">
              No bank details on file. Add them below and they become copyable here.
            </p>
          )}
        </section>

        {/* contact */}
        <section className={cardCls}>
          <h3 className={sectionHeadCls}>Contact</h3>
          {hasContact ? (
            <dl className="mt-1">
              {vendor.contact_person !== null && (
                <div className="flex justify-between gap-3 border-b border-rule-soft py-2 last:border-b-0">
                  <dt className="text-xs font-medium text-stone-500">Person</dt>
                  <dd className="text-right text-sm text-stone-900">{vendor.contact_person}</dd>
                </div>
              )}
              {vendor.phone !== null && (
                <div className="flex items-center justify-between gap-3 border-b border-rule-soft py-2 last:border-b-0">
                  <dt className="text-xs font-medium text-stone-500">Phone</dt>
                  <dd className="text-right text-sm">
                    <a href={`tel:${vendor.phone}`} className="font-mono text-emerald-700 hover:underline">
                      {vendor.phone}
                    </a>
                  </dd>
                </div>
              )}
              {vendor.alt_phone !== null && (
                <div className="flex items-center justify-between gap-3 border-b border-rule-soft py-2 last:border-b-0">
                  <dt className="text-xs font-medium text-stone-500">Alternate</dt>
                  <dd className="text-right text-sm">
                    <a href={`tel:${vendor.alt_phone}`} className="font-mono text-emerald-700 hover:underline">
                      {vendor.alt_phone}
                    </a>
                  </dd>
                </div>
              )}
              {vendor.email !== null && (
                <div className="flex items-center justify-between gap-3 border-b border-rule-soft py-2 last:border-b-0">
                  <dt className="text-xs font-medium text-stone-500">Email</dt>
                  <dd className="min-w-0 break-all text-right text-sm">
                    <a href={`mailto:${vendor.email}`} className="text-emerald-700 hover:underline">
                      {vendor.email}
                    </a>
                  </dd>
                </div>
              )}
              {vendor.address !== null && (
                <div className="border-b border-rule-soft py-2 last:border-b-0">
                  <dt className="text-xs font-medium text-stone-500">Address</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-sm text-stone-900">{vendor.address}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-stone-500">No contact details on file yet.</p>
          )}
          {vendor.gstin !== null && (
            <p className="mt-2 border-t border-rule-soft pt-2 text-xs text-stone-500">
              GSTIN <span className="font-mono text-stone-700">{vendor.gstin}</span>
            </p>
          )}
        </section>
      </div>

      <PaymentForm vendorId={vendor.id} vendorName={vendor.name} modes={modes} />

      {/* payment history */}
      <section className={cardCls}>
        <h3 className={sectionHeadCls}>Payment history</h3>
        {payments.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nothing paid yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Mode</th>
                  <th className={thCls}>Note</th>
                  <th className={thNumCls}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className={trCls}>
                    <td className={tdCls}>{fmtDate(p.paid_date)}</td>
                    <td className={`${tdCls} text-stone-600`}>{p.mode ?? '—'}</td>
                    <td className={`${tdCls} max-w-[16rem] truncate text-stone-500`}>{p.note ?? ''}</td>
                    <td className={`${tdNumCls} font-semibold text-emerald-700`}>
                      −{formatMoneyString(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* bills */}
      <section className={cardCls}>
        <h3 className={sectionHeadCls}>Bill history</h3>
        {bills.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">
            No bills yet — the first purchase from {vendor.name} will appear here.
          </p>
        ) : (
          <div className="mt-1">
            <BillList bills={bills} showVendor={false} />
          </div>
        )}
      </section>

      {vendor.notes !== null && (
        <section className={cardCls}>
          <h3 className={sectionHeadCls}>Notes</h3>
          <p className="mt-1.5 whitespace-pre-line text-sm text-stone-700">{vendor.notes}</p>
        </section>
      )}

      <VendorEdit vendor={vendor} />
    </div>
  )
}
