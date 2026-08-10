'use client'

// Fetch Day: pick a date (default yesterday — today is still ringing up),
// press the button, read the numbers BACK from the database. A re-fetch is
// a new fetch that wins; the reveal says so instead of pretending to edit.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FetchDayResult } from '@/lib/types'
import { fetchDay } from '@/server/sales-actions'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, fieldLabelCls, numCls } from '@/components/ui'

export default function FetchDay({ defaultDate }: { defaultDate: string }) {
  const router = useRouter()
  const [date, setDate] = useState(defaultDate)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Extract<FetchDayResult, { ok: true }> | null>(null)

  async function onFetch() {
    if (fetching) return
    setFetching(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetchDay({ date })
      if (res.ok) {
        setResult(res)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was fetched. Please retry.')
    } finally {
      setFetching(false)
    }
  }

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className={fieldLabelCls}>Business date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls}`} />
        </label>
        <button
          type="button"
          onClick={onFetch}
          disabled={fetching || date === ''}
          className="rounded-xl bg-emerald-700 px-5 py-2.5 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {fetching ? 'Fetching from Petpooja…' : 'Fetch day'}
        </button>
        <p className="basis-full text-xs text-stone-400">
          Re-fetching a date records a new fetch that wins — nothing is edited, the old fetch stays in history.
        </p>
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-emerald-800">
            Fetched {fmtDate(result.businessDate)}
          </h3>
          {result.day ? (
            <>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-stone-900">
                {formatMoneyString(result.day.revenue)}
                <span className="ml-2 text-sm font-medium text-stone-500">
                  {result.day.orders} orders · {result.day.covers} covers
                </span>
              </p>
              <p className="mt-1 text-sm text-stone-600">
                cash {formatMoneyString(result.day.cash_revenue)}
                {result.day.comps > 0 && (
                  <>
                    {' '}
                    · {result.day.comps} comp{result.day.comps === 1 ? '' : 's'} worth{' '}
                    {formatMoneyString(result.day.comp_value)} (out of money, in orders and covers)
                  </>
                )}
                {result.day.cancelled > 0 && <> · {result.day.cancelled} cancelled</>}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-stone-600">
              No orders for this date in the response — {result.insertedOrders} inserted.
            </p>
          )}
          <p className="mt-1.5 text-xs text-stone-500">
            API sent {result.apiOrderCount} order{result.apiOrderCount === 1 ? '' : 's'}; {result.insertedOrders} matched
            this date{result.skippedOtherDates > 0 && <> · {result.skippedOtherDates} from other dates skipped</>}
            {result.duplicateIds > 0 && <> · {result.duplicateIds} duplicate ids skipped</>} · read back from
            sales_by_day
          </p>
          {result.compDisagreements > 0 && (
            <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
              {result.compDisagreements} C-prefixed order{result.compDisagreements === 1 ? '' : 's'} not marked
              Complimentary — the status won; logged on the fetch.
            </p>
          )}
          {result.day !== null && result.day.unknown_status > 0 && (
            <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
              <p className="font-semibold">
                {result.day.unknown_status} order{result.day.unknown_status === 1 ? '' : 's'} with a status this app
                does not recognize — NOT counted as revenue:
              </p>
              <ul className="mt-1 space-y-0.5 font-mono">
                {result.unknownOrders.map((u) => (
                  <li key={u.pos_order_id}>
                    #{u.pos_order_id} “{u.status_raw}” {u.order_total !== null && formatMoneyString(u.order_total)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
