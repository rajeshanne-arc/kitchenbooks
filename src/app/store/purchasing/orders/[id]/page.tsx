import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getLetterhead, getPurchaseOrder } from '@/server/po-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { waLink, waOrderText } from '@/lib/wa'
import { missingLetterheadFields } from '@/lib/letterhead'
import PoActions from '@/components/store/PoActions'
import PoDraft from '@/components/store/PoDraft'
import GapCell from '@/components/kitchen/GapCell'
import Honesty from '@/components/Honesty'
import {
  cardCls,
  dataTableCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const restaurant = await getRestaurant()
  const found = await getPurchaseOrder(restaurant.id, id)
  if (found === null) notFound()
  const { po, lines, fulfilment, matches } = found

  const [letterhead] = await Promise.all([
    getLetterhead(restaurant.id),
  ])
  const missing = missingLetterheadFields(letterhead)

  const anyRate = lines.some((l) => Number(l.rate) > 0)
  const text = waOrderText({
    restaurantName: letterhead.legal_name ?? letterhead.name,
    docNo: po.doc_no,
    poDate: fmtDate(po.po_date),
    expectedDate: po.expected_date === null ? null : fmtDate(po.expected_date),
    lines: lines.map((l) => ({
      item_name: l.item_name,
      qty: String(Number(l.qty)),
      purchase_unit: l.purchase_unit,
      rate: l.rate,
    })),
    total: formatMoneyString(po.total),
    note: po.note,
    anyRate,
  })
  const wa = waLink(po.vendor_phone, text)

  // A DRAFT IS THE FORM. Nothing else in the app shows a document and an
  // editor for it side by side, and here it is the whole point: while it is a
  // draft it is a thing you are still writing.
  if (po.status === 'draft') {
    return (
      <>
        <header className="pb-4">
          <Link href="/store/purchasing/orders" className="text-sm text-stone-500 hover:text-stone-800">
            ← Purchase orders
          </Link>
          <h1 className={`${pageTitleCls} mt-2`}>{po.doc_no ?? 'Draft order'}</h1>
          <p className={pageSubCls}>
            A draft — nothing has gone to {po.vendor_name}. It stays editable until it is sent, and freezes the
            moment it is: what was ordered is what a short is measured against.
          </p>
        </header>
        <div className="space-y-4">
          {po.approval_status === 'pending' ? (
            <section className={cardCls}>
              <Honesty verdict="order frozen for approval" level="pending">
                The order is complete and waiting for an owner. Its lines and amount cannot be changed while the decision is pending.
              </Honesty>
            </section>
          ) : (
            <PoDraft
              poId={po.id}
              vendorId={po.vendor_id}
              vendorName={po.vendor_name}
              vendorPhone={po.vendor_phone}
              today={po.po_date}
              existing={{ poDate: po.po_date, expectedDate: po.expected_date, note: po.note, lines }}
            />
          )}
          <section className={cardCls}>
            <h2 className={sectionHeadCls}>Send it</h2>
            {missing.length > 0 && (
              <div className="mt-2">
                <Honesty verdict="letterhead incomplete" action={{ href: '/owner/setup/letterhead', label: 'Fill it in' }}>
                  The document has no {missing.join(', ')}. It will still print and still send — a vendor
                  reading it sees a list of items from a name with no address.
                </Honesty>
              </div>
            )}
            <div className="mt-3">
              <PoActions
                id={po.id}
                status={po.status}
                approvalStatus={po.approval_status}
                docNo={po.doc_no}
                vendorName={po.vendor_name}
                waHref={wa}
                printHref={`/store/purchasing/orders/${po.id}/print`}
              />
            </div>
          </section>
        </div>
      </>
    )
  }

  return (
    <>
      <header className="pb-4">
        <Link href="/store/purchasing/orders" className="text-sm text-stone-500 hover:text-stone-800">
          ← Purchase orders
        </Link>
        <h1 className={`${pageTitleCls} mt-2`}>{po.doc_no ?? 'Purchase order'}</h1>
        <p className={pageSubCls}>
          {po.vendor_name} · {fmtDate(po.po_date)}
          {po.expected_date !== null && ` · needed by ${fmtDate(po.expected_date)}`}
        </p>
      </header>

      <section className={cardCls}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>
            {po.status === 'cancelled' ? 'Cancelled' : po.status === 'closed' ? 'Closed' : 'Sent'}
          </h2>
          <span className="font-mono text-[11px] text-stone-400">purchase_orders</span>
        </div>
        {po.sent_at !== null ? (
          <p className="mt-1 text-sm text-stone-700">
            Sent {fmtDateTime(po.sent_at)} by {po.sent_by ?? 'somebody'}
            {po.sent_via !== null && ` over ${po.sent_via}`}. What was ordered below is what a delivery is
            measured against, which is why it can be cancelled and never edited.
          </p>
        ) : (
          <p className="mt-1 text-sm text-stone-700">This order was never marked sent.</p>
        )}
        {po.note !== null && <p className="mt-2 text-[13px] text-stone-600">{po.note}</p>}
        <div className="mt-3">
          <PoActions
            id={po.id}
            status={po.status}
            approvalStatus={po.approval_status}
            docNo={po.doc_no}
            vendorName={po.vendor_name}
            waHref={wa}
            printHref={`/store/purchasing/orders/${po.id}/print`}
          />
        </div>
      </section>

      {/* ORDERED · DELIVERED · GAP, the same shape as the indent table, and for
          the same reason: request and receipt are two states of one document,
          so they are two columns rather than two screens. */}
      <section className={`${cardCls} mt-4`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Ordered, and what arrived</h2>
          <span className="font-mono text-[11px] text-stone-400">po_fulfilment</span>
        </div>
        {po.status === 'cancelled' ? (
          <p className="mt-2 text-sm text-stone-600">
            A cancelled order has no shortfall — nobody was ever going to fill it, and the view leaves it out
            rather than counting every line as short.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Item</th>
                  <th className={thNumCls}>Ordered</th>
                  <th className={thNumCls}>Delivered</th>
                  <th className={thCls}>Gap</th>
                  <th className={thNumCls}>Rate</th>
                </tr>
              </thead>
              <tbody>
                {fulfilment.map((f) => (
                  <tr key={f.item_code} className={trCls}>
                    <td className={tdCls}>
                      {f.item_name}
                      <span className={`${tdCodeCls} border-0 p-0`}> {f.item_code}</span>
                    </td>
                    <td className={tdNumCls}>
                      {Number(f.qty_ordered)} {f.purchase_unit}
                    </td>
                    <td className={tdNumCls}>{Number(f.qty_delivered)}</td>
                    <td className={tdCls}>
                      <GapCell gap={f.gap} unit={f.purchase_unit} status={f.status} delivered={f.qty_delivered} />
                    </td>
                    <td className={tdNumCls}>
                      {Number(f.rate) > 0 ? formatMoneyString(f.rate) : <span className="text-stone-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-stone-500">
          Delivered counts bills entered against this order, voided ones excluded — the view filters both
          halves of a reversed pair, so goods that came back do not read as arrived. A bill that cites no
          order is not counted at all —{' '}
          <Link href="/store/purchasing/receive" className="text-emerald-700 hover:underline">
            enter one against it
          </Link>
          .
        </p>
      </section>
      {matches.length > 0 && (
        <section className={`${cardCls} mt-4`}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Invoice matching</h2>
            <span className="font-mono text-[11px] text-stone-400">purchase_invoice_matches</span>
          </div>
          <ul className="mt-2 divide-y divide-rule-soft">
            {matches.slice(0, 12).map((match) => (
              <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>Purchase {match.purchase_id.slice(0, 8)} · {fmtDateTime(match.assessed_at)}</span>
                <span className={match.status === 'exception' ? 'font-semibold text-red-700' : match.status === 'matched' ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                  {match.status}{match.quantity_exception ? ' · quantity' : ''}{match.price_exception ? ' · rate' : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-500">This is an immutable assessment captured when each bill was received. Exceptions require review; the bill itself is never silently changed.</p>
        </section>
      )}
    </>
  )
}
