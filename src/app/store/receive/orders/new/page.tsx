import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getReorderDraft, listVendorsForOrder } from '@/server/po-queries'
import { businessToday } from '@/server/business-day'
import PoDraft from '@/components/store/PoDraft'
import { cardCls, pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

// RAISED FROM REORDER, which already groups what is short by who supplies it —
// that grouping was built because the trip is the unit of work, and until now
// it led nowhere. This is where it leads.

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string }>
}) {
  const { vendor: vendorId } = await searchParams
  const restaurant = await getRestaurant()
  const [vendors, today] = await Promise.all([listVendorsForOrder(restaurant.id), businessToday()])

  if (vendorId === undefined) {
    return (
      <>
        <header className="pb-4">
          <h1 className={pageTitleCls}>Raise a purchase order</h1>
          <p className={pageSubCls}>Pick who it is going to.</p>
        </header>
        <section className={cardCls}>
          <p className="text-sm text-stone-600">
            Reorder groups what is short by who supplies it, and each vendor card there raises an order with
            the quantities already worked out.{' '}
            <Link href="/store/stock/reorder" className="font-medium text-emerald-700 hover:underline">
              Reorder →
            </Link>
          </p>
          <ul className="mt-3 divide-y divide-rule-soft">
            {vendors.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2.5">
                <span>
                  {v.name}
                  <span className="ml-1.5 font-mono text-[11px] text-stone-400">{v.code}</span>
                  {/* LEAD WITH A REASON TO ORDER, and say when there is none —
                      the list is ranked by it, so the ranking has to be legible. */}
                  <span className="ml-2 text-[11px] text-stone-500">
                    {v.due > 0 ? `${v.due} at reorder level` : 'nothing due'}
                  </span>
                  {v.phone === null && <span className="ml-2 text-[11px] text-red-700">no phone</span>}
                </span>
                <Link
                  href={`/store/receive/orders/new?vendor=${v.id}`}
                  className="text-sm font-medium text-emerald-700 hover:underline"
                >
                  Raise →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </>
    )
  }

  const vendor = vendors.find((v) => v.id === vendorId)
  if (vendor === undefined) notFound()
  const suggestions = await getReorderDraft(restaurant.id, vendorId)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Raise a purchase order</h1>
        <p className={pageSubCls}>
          Quantities are par minus what is on the shelf; rates are what {vendor.name} last billed. Both are
          offers — nothing is written until you save, and nothing leaves the building until you send.
        </p>
      </header>
      <PoDraft
        vendorId={vendor.id}
        vendorName={vendor.name}
        vendorPhone={vendor.phone}
        today={today}
        suggestions={suggestions}
      />
    </>
  )
}
