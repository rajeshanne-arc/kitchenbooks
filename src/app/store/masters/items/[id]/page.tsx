import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant, getMasters } from '@/server/queries'
import { getItemDetail, getItemHistory, listActiveVendors } from '@/server/books-queries'
import { listActiveLocations } from '@/server/locations-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { RetiredBadge } from '@/components/books/Badges'
import ItemEdit from '@/components/books/ItemEdit'
import { cardCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const item = await getItemDetail(restaurant.id, id)
  if (!item) notFound()

  const [{ units }, history, vendors, locations] = await Promise.all([
    getMasters(),
    getItemHistory(restaurant.id, id),
    listActiveVendors(restaurant.id),
    listActiveLocations(restaurant.id),
  ])

  return (
    <div className="mt-4 space-y-4">
      <Link href="/store/masters/items" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Items
      </Link>

      <section className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-stone-900">{item.name}</h2>
              {item.status === 'inactive' && <RetiredBadge />}
            </div>
            <p className="mt-0.5 text-sm text-stone-500">
              <span className="font-mono">{item.code}</span> · {item.category_name} · bought per{' '}
              {item.purchase_unit_name}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Rate prefill</div>
            {item.prefill_rate !== null ? (
              <>
                <div className="text-2xl font-bold tabular-nums tracking-tight text-stone-900">
                  {formatMoneyString(item.prefill_rate)}
                </div>
                <div className="mt-0.5 text-xs text-stone-500">
                  {item.last_rate !== null && item.last_rate_date !== null
                    ? `last billed ${fmtDate(item.last_rate_date)}`
                    : 'from opening rate — no bills yet'}
                  {' · item_rates'}
                </div>
              </>
            ) : (
              <div className="text-sm text-stone-400">
                none yet — the first bill sets it
                <br />
                (or seed an opening rate below)
              </div>
            )}
          </div>
        </div>
      </section>

      <ItemEdit locations={locations} item={item} units={units} vendors={vendors} />

      <section className={cardCls}>
        <h3 className={sectionHeadCls}>Purchase history</h3>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No purchases yet — history starts with the first bill.</p>
        ) : (
          <ul className="mt-1 divide-y divide-rule-soft">
            {history.map((h, idx) => (
              <li key={`${h.purchase_id}-${idx}`}>
                <Link
                  href={`/store/books/bills/${h.purchase_id}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-1 py-2.5 hover:bg-stone-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] text-stone-900">{h.vendor_name}</span>
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {fmtDate(h.bill_date)} · {h.qty} × {formatMoneyString(h.rate)}
                      {h.landed !== h.amount && <> · landed {formatMoneyString(h.landed)}</>}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-stone-900">
                    {formatMoneyString(h.amount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
