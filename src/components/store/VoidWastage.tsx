'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { voidWastage } from '@/server/store-actions'
import type { VoidWastageResult } from '@/lib/types'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'

export default function VoidWastage({
  wastageId,
  itemName,
  value,
  wasteDate,
}: {
  wastageId: string
  itemName: string
  value: string
  wasteDate: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Extract<VoidWastageResult, { ok: true }> | null>(null)
  const router = useRouter()

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await voidWastage(wastageId)
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
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-emerald-800">Write-off reversed</h3>
        <p className="mt-2 text-sm text-stone-700">
          A{' '}
          <Link href={`/store/books/wastage/${done.reversal.id}`} className="font-medium text-emerald-800 underline">
            reversal entry
          </Link>{' '}
          for <span className="font-semibold tabular-nums">{formatMoneyString(done.reversal.value)}</span> cancels this
          write-off — same unit cost, copied exactly.
        </p>
        <p className="mt-2 text-[15px] text-stone-900">
          {done.stock.name} back to{' '}
          <span className="text-xl font-bold tabular-nums">
            {done.stock.on_hand_qty} {done.stock.purchase_unit}
          </span>{' '}
          on hand
        </p>
        <p className="mt-1 text-xs text-stone-500">read live from stock_on_hand</p>
      </section>
    )
  }

  return (
    <>
      <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-medium uppercase tracking-wide text-red-700">Danger zone</h3>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-sm text-sm text-stone-600">
            Recorded by mistake? Voiding inserts a reversal — the stock and the write-off value restore themselves.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            Void this entry…
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
            <h3 className="text-lg font-bold text-stone-900">Void this wastage entry?</h3>
            <div className="mt-3 space-y-2 text-sm text-stone-600">
              <p>
                This inserts a negative twin of the {fmtDate(wasteDate)} write-off of <b>{itemName}</b> (
                {formatMoneyString(`-${value}`)}), pointing back at the original — same unit cost, copied exactly.
              </p>
              <p>Nothing is edited or deleted; both entries stay visible in the store log.</p>
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
                {busy ? 'Voiding…' : 'Void entry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
