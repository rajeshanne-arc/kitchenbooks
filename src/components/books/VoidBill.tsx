'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { voidBill } from '@/server/books-actions'
import type { VoidBillResult } from '@/lib/types'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'

export default function VoidBill({
  billId,
  billTotal,
  vendorName,
  billDate,
  billNo,
}: {
  billId: string
  billTotal: string
  vendorName: string
  billDate: string
  billNo: string | null
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Extract<VoidBillResult, { ok: true }> | null>(null)
  const router = useRouter()

  const revNo = billNo ? `${billNo}-VOID` : `VOID-${billId.slice(0, 8)}`

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await voidBill(billId)
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
        <h3 className="text-xs font-medium uppercase tracking-wide text-emerald-800">Bill voided</h3>
        <p className="mt-2 text-sm text-stone-700">
          Reversal bill{' '}
          <Link href={`/books/bills/${done.reversal.id}`} className="font-medium text-emerald-800 underline">
            {done.reversal.bill_no}
          </Link>{' '}
          for <span className="font-semibold tabular-nums">{formatMoneyString(done.reversal.bill_total)}</span> now
          cancels this one — both stay in the books.
        </p>
        <p className="mt-2 text-[15px] text-stone-900">
          Dues for {vendorName}:{' '}
          {done.duesBefore !== null && (
            <>
              <span className="tabular-nums">{formatMoneyString(done.duesBefore)}</span>
              {' → '}
            </>
          )}
          <span className="text-xl font-bold tabular-nums">{formatMoneyString(done.dues.balance)}</span>
        </p>
        <p className="mt-1 text-xs text-stone-500">read live from vendor_dues after the reversal landed</p>
      </section>
    )
  }

  return (
    <>
      <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-medium uppercase tracking-wide text-red-700">Danger zone</h3>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-sm text-sm text-stone-600">
            Wrong bill? Voiding cancels it with a reversal entry — the original is never edited and never disappears.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            Void this bill…
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
            <h3 className="text-lg font-bold text-stone-900">Void this bill?</h3>
            <div className="mt-3 space-y-2 text-sm text-stone-600">
              <p>
                This inserts reversal bill <span className="font-mono font-medium text-stone-900">{revNo}</span> — an
                exact negative copy ({formatMoneyString(`-${billTotal}`)}) dated {fmtDate(billDate)}, pointing back at
                this bill.
              </p>
              <p>
                Nothing is edited or deleted: the two bills cancel to zero and {vendorName}’s dues update on their own.
                Both stay visible in the books permanently.
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
                {busy ? 'Voiding…' : 'Void bill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
