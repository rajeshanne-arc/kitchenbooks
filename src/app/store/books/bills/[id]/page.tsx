import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { listAttachments } from '@/server/attachments-queries'
import { getBill, getBillLines, getVoidedBy } from '@/server/books-queries'
import { listShortsForPurchase } from '@/server/shorts-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { ReversalBadge, VoidedBadge } from '@/components/books/Badges'
import VoidBill from '@/components/books/VoidBill'
import BillShorts from '@/components/store/BillShorts'
import BillPhotos from '@/components/books/BillPhotos'
import { cardCls, docNoCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const bill = await getBill(restaurant.id, id)
  if (!bill) notFound()

  const [lines, voidedBy, original, shorts, photos] = await Promise.all([
    getBillLines(bill.id),
    bill.is_voided ? getVoidedBy(bill.id) : Promise.resolve(null),
    bill.reverses_id !== null ? getBill(restaurant.id, bill.reverses_id) : Promise.resolve(null),
    listShortsForPurchase(restaurant.id, bill.id),
    listAttachments(restaurant.id, 'purchase', bill.id),
  ])

  // A short is owed on the bill that was actually delivered against. A
  // reversal has no delivery of its own, and a voided bill has nothing left
  // for the vendor to owe — both still SHOW what was recorded before.
  const shortsLocked = bill.is_reversal
    ? 'This is a reversal bill — a short belongs on the bill it cancels.'
    : bill.is_voided
      ? 'This bill was voided, so there is nothing left for the vendor to owe on it.'
      : null

  return (
    <div className="mt-4 space-y-4">
      <Link href="/store/books/bills" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Bills
      </Link>

      {bill.is_voided && voidedBy !== null && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          This bill was voided —{' '}
          <Link href={`/store/books/bills/${voidedBy.id}`} className="font-medium underline">
            reversal {voidedBy.bill_no ?? 'bill'}
          </Link>{' '}
          cancels it. Totals and dues already reflect that.
        </div>
      )}
      {bill.is_reversal && bill.reverses_id !== null && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">
          Reversal bill — inserted to cancel{' '}
          <Link href={`/store/books/bills/${bill.reverses_id}`} className="font-medium underline">
            {original?.bill_no ?? `the bill of ${original ? fmtDate(original.bill_date) : 'record'}`}
          </Link>
          . Nothing was edited; this negative copy does the correcting.
        </div>
      )}

      <section className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* THE NAME IS A DOOR. Reading a bill and wanting the vendor —
                  their balance, their banking card, what else they have sent —
                  is the commonest next question this page raises, and the
                  name was the one thing on it that answered nothing. Same
                  matrix rule covers both paths, so no role sees a link it
                  cannot open. */}
              <h2 className="text-lg font-bold text-stone-900">
                <Link
                  href={`/store/masters/vendors/${bill.vendor_id}`}
                  className="underline decoration-stone-300 underline-offset-4 hover:decoration-stone-600"
                >
                  {bill.vendor_name}
                </Link>
              </h2>
              {bill.is_voided && <VoidedBadge />}
              {bill.is_reversal && <ReversalBadge />}
            </div>
            <p className="mt-0.5 text-sm text-stone-500">
              {fmtDate(bill.bill_date)} · <span className="font-mono">{bill.vendor_code}</span>
              {bill.bill_no !== null && <> · {bill.bill_no}</>}
            </p>
            {/* the handle an accountant's question will name months later */}
            {bill.doc_no !== null && <p className={`mt-1 ${docNoCls}`}>{bill.doc_no}</p>}
            <p className="mt-0.5 text-xs text-stone-400">
              entered by {bill.entered_by ?? '—'} · {fmtDateTime(bill.created_at)}
            </p>
          </div>
          <Link
            href={`/store/masters/vendors/${bill.vendor_id}`}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50"
          >
            Vendor page →
          </Link>
        </div>

        <div className="mt-4 border-t border-stone-100 pt-3">
          <h3 className={sectionHeadCls}>Lines</h3>
          <ul className="mt-1 divide-y divide-rule-soft">
            {lines.map((l) => {
              const extras: string[] = []
              if (decimalStringToPaise(l.gst_amount) !== 0) extras.push(`GST ${formatMoneyString(l.gst_amount)}`)
              if (decimalStringToPaise(l.transport_alloc) !== 0)
                extras.push(`transport ${formatMoneyString(l.transport_alloc)}`)
              if (extras.length > 0) extras.push(`landed ${formatMoneyString(l.landed)}`)
              return (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/store/masters/items/${l.item_id}`} className="group flex items-center gap-2">
                      <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-700">
                        {l.item_code}
                      </code>
                      <span className="truncate text-[15px] text-stone-900 group-hover:underline">{l.item_name}</span>
                    </Link>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {l.qty} {l.purchase_unit} × {formatMoneyString(l.rate)}
                      {extras.length > 0 && <> · {extras.join(' · ')}</>}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums text-stone-900">
                    {formatMoneyString(l.amount)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        <dl className="mt-2 space-y-1.5 border-t border-stone-100 pt-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-stone-500">Goods</dt>
            <dd className="font-medium tabular-nums">{formatMoneyString(bill.goods_total)}</dd>
          </div>
          {decimalStringToPaise(bill.gst_total) !== 0 && (
            <div className="flex items-center justify-between">
              <dt className="text-stone-500">GST</dt>
              <dd className="font-medium tabular-nums">{formatMoneyString(bill.gst_total)}</dd>
            </div>
          )}
          {decimalStringToPaise(bill.transport) !== 0 && (
            <div className="flex items-center justify-between">
              <dt className="text-stone-500">Transport</dt>
              <dd className="font-medium tabular-nums">{formatMoneyString(bill.transport)}</dd>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-stone-100 pt-2.5">
            <dt className="font-medium text-stone-500">Bill total</dt>
            <dd className="text-2xl font-bold tabular-nums tracking-tight text-stone-900">
              {formatMoneyString(bill.bill_total)}
            </dd>
          </div>
        </dl>
      </section>

      {/* THE PAPER, directly under the figures it is evidence for. Every other
          reconciliation in this app compares one query with another; this is
          the only thing that can be checked against something outside it. */}
      <section className={cardCls}>
        <BillPhotos purchaseId={id} initial={photos} />
      </section>

      <BillShorts
        purchaseId={id}
        lines={lines.map((l) => ({
          id: l.id,
          item_code: l.item_code,
          item_name: l.item_name,
          purchase_unit: l.purchase_unit,
          qty: l.qty,
          rate: l.rate,
        }))}
        shorts={shorts}
        locked={shortsLocked}
      />

      {!bill.is_reversal && !bill.is_voided && (
        <VoidBill
          billId={bill.id}
          billTotal={bill.bill_total}
          vendorName={bill.vendor_name}
          billDate={bill.bill_date}
          billNo={bill.bill_no}
        />
      )}
    </div>
  )
}
