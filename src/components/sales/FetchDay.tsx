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

type DayProgress = { date: string; state: 'waiting' | 'fetching' | 'done' | 'failed'; detail: string }

/** Every business date from `from` to `to`, inclusive. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = new Date(`${from}T00:00:00Z`); t <= new Date(`${to}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1)) {
    out.push(t.toISOString().slice(0, 10))
    if (out.length > 62) break
  }
  return out
}

export default function FetchDay({ defaultDate, today }: { defaultDate: string; today: string }) {
  const router = useRouter()
  const [date, setDate] = useState(defaultDate)
  const [to, setTo] = useState('')
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Extract<FetchDayResult, { ok: true }> | null>(null)
  const [progress, setProgress] = useState<DayProgress[]>([])

  /**
   * A RANGE IS N CALLS, NOT ONE — Get Orders returns two days per call
   * (D and D-1) and is keyed on one business date, so a range loops the same
   * per-day fetch rather than growing a bulk endpoint. That keeps the per-day
   * dedupe and latest-fetch-wins exactly as they are, and it is why progress
   * is shown per day: a five-day catch-up is five round trips to Petpooja,
   * and a spinner over all of them would just look hung.
   */
  async function run(dates: string[]) {
    if (fetching || dates.length === 0) return
    setFetching(true)
    setError(null)
    setResult(null)
    setProgress(dates.map((d) => ({ date: d, state: 'waiting', detail: '' })))
    let last: Extract<FetchDayResult, { ok: true }> | null = null
    for (const d of dates) {
      setProgress((p) => p.map((x) => (x.date === d ? { ...x, state: 'fetching' } : x)))
      try {
        const res = await fetchDay({ date: d })
        if (res.ok) {
          last = res
          setProgress((p) =>
            p.map((x) =>
              x.date === d
                ? {
                    ...x,
                    state: 'done',
                    detail: `${res.insertedOrders} order${res.insertedOrders === 1 ? '' : 's'}${
                      res.day !== null ? ` · ${formatMoneyString(res.day.revenue)}` : ''
                    }`,
                  }
                : x,
            ),
          )
        } else {
          setProgress((p) => p.map((x) => (x.date === d ? { ...x, state: 'failed', detail: res.error } : x)))
        }
      } catch {
        setProgress((p) =>
          p.map((x) => (x.date === d ? { ...x, state: 'failed', detail: 'could not reach the server' } : x)),
        )
      }
    }
    // The reveal shows the LAST day fetched; the per-day list above it is
    // what says how the others went. A range that half-failed must not look
    // like a range that succeeded.
    if (last !== null) setResult(last)
    router.refresh()
    setFetching(false)
  }

  const onFetch = () => void run(to === '' ? [date] : daysBetween(date, to))

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className={fieldLabelCls}>Business date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls}`} />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>to (optional)</span>
          <input
            type="date"
            value={to}
            min={date}
            max={today}
            onChange={(e) => setTo(e.target.value)}
            className={`${numCls}`}
          />
        </label>
        <button
          type="button"
          onClick={onFetch}
          disabled={fetching || date === '' || (to !== '' && to < date)}
          className="rounded-xl bg-emerald-700 px-5 py-2.5 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {fetching
            ? 'Fetching from Petpooja…'
            : to === ''
              ? 'Fetch day'
              : `Fetch ${daysBetween(date, to).length} days`}
        </button>
        <button
          type="button"
          onClick={() => {
            setTo('')
            setDate(today)
            void run([today])
          }}
          disabled={fetching}
          className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 hover:border-emerald-400 disabled:opacity-50"
        >
          Fetch today
        </button>
        <p className="basis-full text-xs text-stone-400">
          Re-fetching a date records a new fetch that wins — nothing is edited, the old fetch stays in history.
        </p>
      </div>

      {progress.length > 1 && (
        <ul className="mt-3 divide-y divide-rule-soft rounded-xl border border-rule">
          {progress.map((d) => (
            <li key={d.date} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
              <span className="tabular-nums text-stone-700">{fmtDate(d.date)}</span>
              <span
                className={
                  d.state === 'failed'
                    ? 'text-red-700'
                    : d.state === 'done'
                      ? 'text-stone-600'
                      : 'text-stone-400'
                }
              >
                {d.state === 'waiting' && 'waiting'}
                {d.state === 'fetching' && 'fetching…'}
                {d.state !== 'waiting' && d.state !== 'fetching' && d.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

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
          {/* WHAT PETPOOJA ACTUALLY SENT. Key names only — no values are read,
              logged or stored. It exists to settle, in one real fetch, two
              questions nobody could answer from the code: whether an item
              code arrives (we key on the internal id and always will, but a
              code shown beside the name would ease matching), and whether any
              of the leakage fields Petpooja's own dashboard reports are in
              the payload at all. Read it once and it has done its job. */}
          <details className="mt-3 rounded-lg border border-stone-200 bg-white/70 px-2.5 py-1.5">
            <summary className="cursor-pointer text-xs font-medium text-stone-600">
              What Petpooja sent — {result.census.orderKeys.length} order fields,{' '}
              {result.census.itemKeys.length} item fields
            </summary>
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-stone-600">
              <p>
                <span className="font-semibold text-stone-700">An item code? </span>
                {result.census.candidates.itemCode.length === 0 ? (
                  <span className="text-amber-800">
                    No field on an item looks like a code. We key on Petpooja&rsquo;s internal item id and always
                    will; there is nothing to show beside the name.
                  </span>
                ) : (
                  <span className="text-emerald-800">
                    yes — <span className="font-mono">{result.census.candidates.itemCode.join(', ')}</span>. It can be
                    SHOWN beside the name; it must never be keyed on, because item codes have no uniqueness check.
                  </span>
                )}
              </p>
              <p>
                <span className="font-semibold text-stone-700">Anything about leakage? </span>
                {result.census.candidates.leakage.length === 0 ? (
                  <span className="text-amber-800">
                    Nothing that looks like a KOT cancellation, bill modification, re-print, waiver or biller. Those
                    are on Petpooja&rsquo;s own dashboard, so they exist — they are just not in Get Orders. Something
                    to ask them to expose.
                  </span>
                ) : (
                  <span className="text-emerald-800">
                    yes — <span className="font-mono">{result.census.candidates.leakage.join(', ')}</span>. A control
                    report is worth building on these.
                  </span>
                )}
              </p>
              <p className="border-t border-stone-100 pt-1.5">
                <span className="font-semibold text-stone-700">Order: </span>
                <span className="font-mono">{result.census.orderKeys.join(', ') || '(none)'}</span>
              </p>
              <p>
                <span className="font-semibold text-stone-700">Item: </span>
                <span className="font-mono">{result.census.itemKeys.join(', ') || '(none)'}</span>
              </p>
              <p className="text-stone-400">
                Key names only. No value from the payload is read, shown or stored here.
              </p>
            </div>
          </details>

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
