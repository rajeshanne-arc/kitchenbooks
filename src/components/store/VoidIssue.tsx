'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { voidIssue } from '@/server/store-actions'
import type { VoidIssueResult } from '@/lib/types'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import SaveAck from '@/components/SaveAck'

export default function VoidIssue({
  issueId,
  sectionName,
  totalValue,
  issueDate,
}: {
  issueId: string
  sectionName: string
  totalValue: string
  issueDate: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Extract<VoidIssueResult, { ok: true }> | null>(null)
  const router = useRouter()

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await voidIssue(issueId)
      if (res.ok) {
        setDone(res)
        setOpen(false)
        router.refresh()
      } else {
        setError(res.error)
        setOpen(false)
      }
    } catch {
      setError('Could not reach the server — nothing was voided.')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <SaveAck
        headline={`Issue voided — ${formatMoneyString(done.reversal.total_value)} reversed`}
        sub={`${sectionName} this month is now ${formatMoneyString(done.monthValue)}. Unit costs were copied exactly from the original lines, never re-snapshotted.`}
      >
        <p className="mt-2 text-sm text-stone-700">
          A{' '}
          <Link href={`/store/books/issues/${done.reversal.id}`} className="font-medium text-emerald-800 underline">
            reversal issue
          </Link>{' '}
          for <span className="font-semibold tabular-nums">{formatMoneyString(done.reversal.total_value)}</span> now
          cancels this one — unit costs copied exactly from the original lines.
        </p>
        <p className="mt-2 text-[15px] text-stone-900">
          {sectionName} this month:{' '}
          <span className="text-xl font-bold tabular-nums">{formatMoneyString(done.monthValue)}</span>
          <span className="ml-1 text-xs text-stone-500">· section_consumption</span>
        </p>
        <ul className="mt-2 space-y-1">
          {done.stock.map((s) => (
            <li key={s.item_id} className="flex items-center justify-between gap-3 text-sm text-stone-800">
              <span className="min-w-0 truncate">{s.name}</span>
              <span className="shrink-0 font-medium tabular-nums">
                back to {s.on_hand_qty} {s.purchase_unit}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-xs text-stone-500">read live from stock_on_hand</p>
      </SaveAck>
    )
  }

  return (
    <>
      <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-medium uppercase tracking-wide text-red-700">Danger zone</h3>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-sm text-sm text-stone-600">
            Wrong issue? Voiding cancels it with a reversal entry — stock and section totals restore themselves.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            Void this issue…
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
            {error}
          </p>
        )}
      </section>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-bold text-stone-900">Void this issue?</h3>
            <div className="mt-3 space-y-2 text-sm text-stone-600">
              <p>
                This inserts a negative twin of the {fmtDate(issueDate)} issue to <b>{sectionName}</b> (
                {formatMoneyString(`-${totalValue}`)}), pointing back at the original.
              </p>
              <p>
                Each line’s unit cost is copied exactly — never re-priced — so stock and {sectionName}’s consumption
                restore to the paisa. Both entries stay visible in the store log.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-xl px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:bg-stone-300"
              >
                {busy ? 'Voiding…' : 'Void issue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
