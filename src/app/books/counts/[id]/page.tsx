import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getCount, getCountVariances } from '@/server/counts-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { cardCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export default async function CountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const count = await getCount(restaurant.id, id)
  if (!count) notFound()
  const variances = await getCountVariances(restaurant.id, id)
  const total = decimalStringToPaise(count.total_variance_value)

  return (
    <div className="mt-4">
      <Link href="/books/counts" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Counts
      </Link>
      <section className={`${cardCls} mt-3`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold text-stone-900">{fmtDate(count.count_date)}</h2>
          <span className="text-xs text-stone-400">saved {fmtDateTime(count.created_at)}</span>
        </div>
        {count.note !== null && <p className="mt-0.5 text-sm text-stone-500">{count.note}</p>}
        <p className={`mt-2 text-3xl font-bold tabular-nums ${total < 0 ? 'text-red-700' : 'text-stone-900'}`}>
          {formatMoneyString(count.total_variance_value)}
        </p>
        <p className="mt-0.5 text-sm text-stone-500">
          total variance · book and cost frozen at count time — worst shortage first
        </p>
        <ul className="mt-3 divide-y divide-stone-100">
          {variances.map((v) => {
            const neg = decimalStringToPaise(v.variance_value) < 0
            return (
              <li key={v.item_id} className={`py-2.5 ${neg ? 'rounded-lg bg-red-50 px-2' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className={`block truncate text-[15px] font-medium ${neg ? 'text-red-800' : 'text-stone-900'}`}>
                      {v.name} <span className="ml-1 font-mono text-[11px] font-normal text-stone-400">{v.code}</span>
                    </span>
                    <span className="block text-xs tabular-nums text-stone-500">
                      counted {v.counted_qty} · book {v.book_qty} {v.purchase_unit} · Δ {v.variance_qty} @{' '}
                      {formatMoneyString(v.unit_cost)}
                    </span>
                  </span>
                  <span className={`text-right text-[15px] font-semibold tabular-nums ${neg ? 'text-red-700' : 'text-stone-700'}`}>
                    {formatMoneyString(v.variance_value)}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
