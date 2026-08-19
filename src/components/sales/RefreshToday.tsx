'use client'

// A BUTTON, NOT A LIVE VIEW.
//
// Polling, websockets and auto-refresh would be infrastructure competing with
// Petpooja's own dashboard — which is itself not live: its terminal syncs
// periodically. So this fetches TODAY on demand: one API call, no new moving
// parts, and the re-fetch semantics already exist (latest fetch per date
// wins; nothing is edited).
//
// TWO RULES COME WITH IT.
//
//   a) STATE THE FRESHNESS, ALWAYS. A stale number that looks live is worse
//      than an obviously stale one. What we can honestly state is when WE
//      fetched — Petpooja's own terminal sync may be older than that, and the
//      caption says so rather than implying our fetch time is the POS's.
//   b) TODAY IS A PARTIAL DAY. It is not closed, it does not enter the
//      day-close chain, and every figure drawn from it says "the day so far"
//      — otherwise somebody compares half a day against yesterday's whole one.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchDay } from '@/server/sales-actions'
import { formatMoneyString } from '@/lib/money'
import { toast } from '@/components/Toasts'

/** "as of 9:42 pm", and how old when it is old. */
function freshness(lastFetchedAt: string | null): { label: string; stale: boolean } {
  if (lastFetchedAt === null) return { label: 'never fetched', stale: true }
  const then = new Date(lastFetchedAt)
  const mins = Math.max(0, Math.round((Date.now() - then.getTime()) / 60000))
  const clock = then.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  if (mins < 45) return { label: `as of ${clock}`, stale: false }
  if (mins < 120) return { label: `as of ${clock} — about an hour ago`, stale: true }
  const hours = Math.round(mins / 60)
  if (hours < 24) return { label: `as of ${clock} — ${hours} hours ago`, stale: true }
  return { label: `as of ${clock} — ${Math.round(hours / 24)} days ago`, stale: true }
}

export default function RefreshToday({
  today,
  orders,
  revenue,
  lastFetchedAt,
}: {
  today: string
  orders: number
  revenue: string | null
  lastFetchedAt: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const f = freshness(lastFetchedAt)

  async function refresh() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetchDay({ date: today })
      if (res.ok) {
        toast(
          res.day === null
            ? 'Nothing rung up yet today'
            : `${res.day.orders} orders · ${formatMoneyString(res.day.revenue)} — the day so far`,
        )
        router.refresh()
      } else {
        toast(res.error, 'error')
      }
    } catch {
      toast('Could not reach the server — nothing was fetched.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p className="text-sm">
        {revenue === null ? (
          <span className="text-stone-500">Nothing fetched for today yet.</span>
        ) : (
          <>
            <span className="font-semibold tabular-nums text-stone-900">{orders} orders</span>
            <span className="text-stone-400"> · </span>
            <span className="font-semibold tabular-nums text-stone-900">{formatMoneyString(revenue)}</span>
            <span className="text-stone-500"> — the day so far</span>
          </>
        )}
        <span className={`ml-2 text-xs ${f.stale ? 'font-medium text-amber-800' : 'text-stone-400'}`}>{f.label}</span>
      </p>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={busy}
        className="shrink-0 rounded-xl border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 hover:border-emerald-400 disabled:opacity-50"
      >
        {busy ? 'Fetching…' : 'Refresh'}
      </button>
      <p className="basis-full text-[11px] text-stone-400">
        This is when KitchenBooks last fetched. Petpooja&rsquo;s own terminal sync may be older — the POS is not live
        either. Today is a partial day and never enters the day-close chain.
      </p>
    </div>
  )
}
