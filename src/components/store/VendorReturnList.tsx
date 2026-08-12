'use client'

// What went back, and what has not come back yet.
//
// The WAITING state is the point of this screen. A return is goods gone and
// money not yet returned: the credit note is the vendor admitting they owe it,
// and until that number exists the claim is ours alone. So the waiting list
// sits above the history, oldest first — the longest wait is the one to chase.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { VendorReturnRow } from '@/lib/types'
import { recordCreditNote, voidVendorReturn } from '@/server/vendor-return-actions'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty, { HonestyPill } from '@/components/Honesty'
import { toast } from '@/components/Toasts'
import {
  btnGhostCls,
  cardCls,
  dataTableCls,
  docNoCls,
  fieldLabelCls,
  inputCls,
  sectionHeadCls,
  selectCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

/** A bill the credit could be set against. Shaped here rather than imported:
 *  the query it comes from is server-only. */
type BillOption = {
  vendor_id: string
  id: string
  doc_no: string | null
  bill_no: string | null
  bill_date: string
  bill_total: string
}

export default function VendorReturnList({
  awaiting,
  recent,
  billOptions,
  progress,
}: {
  awaiting: VendorReturnRow[]
  recent: VendorReturnRow[]
  billOptions: BillOption[]
  progress: { settled: number; total: number; owed: string }
}) {
  const router = useRouter()
  const [openRef, setOpenRef] = useState<string | null>(null)
  const [confirmVoid, setConfirmVoid] = useState<VendorReturnRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runVoid(row: VendorReturnRow) {
    setBusy(true)
    setError(null)
    try {
      const res = await voidVendorReturn(row.id)
      if (res.ok) {
        toast('Return voided — the credit is cancelled')
        setConfirmVoid(null)
        router.refresh()
      } else {
        setError(res.error)
        setConfirmVoid(null)
      }
    } catch {
      setError('Could not reach the server — nothing was voided.')
      setConfirmVoid(null)
    } finally {
      setBusy(false)
    }
  }

  const anyVoided = recent.some((r) => r.is_voided)

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Waiting on a credit note</h2>
          <span className="text-xs text-stone-400">vendor_returns</span>
        </div>

        {/* "nothing has gone back yet" would be false the moment a return has
            been voided — one exists, it just no longer stands. Say what is
            true in both cases. */}
        {progress.total === 0 ? (
          <p className="mt-2 text-sm text-stone-700">
            No return is standing against a vendor. When goods go back, the return is recorded above and waits
            here until they issue the credit note.
          </p>
        ) : awaiting.length === 0 ? (
          <p className="mt-2 text-sm text-stone-700">
            Every return on file has its credit note. Nothing is outstanding with a vendor.
          </p>
        ) : (
          <>
            <div className="mt-3">
              <Honesty
                verdict="Credit not back"
                meter={{ filled: progress.settled, total: progress.total, unit: 'returns' }}
              >
                {formatMoneyString(progress.owed)} of goods has gone back with no credit note against it. The
                balance already treats it as ours; the vendor has not yet said it is.
              </Honesty>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Went back</th>
                    <th className={thCls}>Vendor</th>
                    <th className={thCls}>Why</th>
                    <th className={thNumCls}>Items</th>
                    <th className={thNumCls}>Credit claimed</th>
                    <th className={thCls}>
                      <span className="sr-only">Record the credit note</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {awaiting.map((r) => {
                    const bills = billOptions.filter((b) => b.vendor_id === r.vendor_id)
                    return (
                      <RowPair
                        key={r.id}
                        row={r}
                        bills={bills}
                        open={openRef === r.id}
                        onToggle={() => setOpenRef((cur) => (cur === r.id ? null : r.id))}
                        onDone={() => {
                          setOpenRef(null)
                          router.refresh()
                        }}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {recent.length > 0 && (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Recent returns</h2>
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Vendor</th>
                  <th className={thCls}>Why</th>
                  <th className={thCls}>Credit note</th>
                  <th className={thNumCls}>Items</th>
                  <th className={thNumCls}>Value</th>
                  <th className={thCls}>
                    <span className="sr-only">Void</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className={trCls}>
                    <td className={tdCls}>{fmtDate(r.return_date)}</td>
                    <td className={`${tdCls} font-medium`}>{r.vendor_name}</td>
                    <td className={`${tdCls} text-stone-500`}>{r.reason}</td>
                    <td className={tdCls}>
                      {r.is_reversal ? (
                        <span className="text-xs font-medium text-stone-500">correction</span>
                      ) : r.is_voided ? (
                        <span className="text-xs font-medium text-red-800">voided</span>
                      ) : r.credit_note_ref !== null ? (
                        <span className={docNoCls}>{r.credit_note_ref}</span>
                      ) : (
                        <HonestyPill>awaiting</HonestyPill>
                      )}
                    </td>
                    <td className={tdNumCls}>{r.line_count}</td>
                    <td className={`${tdNumCls} font-semibold`}>{formatMoneyString(r.total)}</td>
                    <td className={`${tdCls} text-right`}>
                      {!r.is_reversal && !r.is_voided && (
                        <button
                          type="button"
                          onClick={() => setConfirmVoid(r)}
                          className="min-h-[40px] rounded-lg border border-red-300 px-2.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {anyVoided && (
            <div className="mt-3">
              {/* Stated once, where the voided rows are, rather than a figure
                  invented to make the book look right. Measured, not guessed:
                  a 10-unit return voided leaves the book 20 short. */}
              <Honesty level="alarm" verdict="Book is short twice over">
                A void cancels the credit to the paisa, but stock_on_hand cannot tell a reversal from a return —
                it subtracts the reversal&apos;s quantity as well, so the book is now short by TWICE what went
                back. Put it right on a stock adjustment; the next count finds it either way.
              </Honesty>
            </div>
          )}
        </section>
      )}

      {error !== null && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {confirmVoid !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-rule bg-cell p-5 shadow-xl">
            <h3 className="text-lg font-bold text-stone-900">Void this return?</h3>
            <div className="mt-3 space-y-2 text-sm text-stone-600">
              <p>
                The {fmtDate(confirmVoid.return_date)} return to <b>{confirmVoid.vendor_name}</b> for{' '}
                <b>{formatMoneyString(confirmVoid.total)}</b> stays on record; a reversal is written against it
                and the credit comes off what we claim, exactly.
              </p>
              <p>
                It does <b>not</b> put the goods back on the book. Worse: stock_on_hand counts the reversal as
                another return, so the book will read {confirmVoid.line_count === 1 ? 'the item' : 'these items'}{' '}
                <b>twice short</b> until somebody puts it right on a stock adjustment.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmVoid(null)}
                disabled={busy}
                className="rounded-xl px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runVoid(confirmVoid)}
                disabled={busy}
                className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:bg-stone-300"
              >
                {busy ? 'Voiding…' : 'Void return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** One waiting row, and the credit-note form it opens. Two <tr>s rather than a
 *  dialog: the row it belongs to stays on screen while it is filled in. */
function RowPair({
  row,
  bills,
  open,
  onToggle,
  onDone,
}: {
  row: VendorReturnRow
  bills: BillOption[]
  open: boolean
  onToggle: () => void
  onDone: () => void
}) {
  const [ref, setRef] = useState('')
  const [purchaseId, setPurchaseId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (ref.trim() === '') return
    setSaving(true)
    setError(null)
    try {
      const res = await recordCreditNote(row.id, ref.trim(), purchaseId)
      if (res.ok) {
        toast('Credit note recorded')
        setRef('')
        setPurchaseId('')
        onDone()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was recorded.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <tr className={trCls}>
        <td className={tdCls}>{fmtDate(row.return_date)}</td>
        <td className={`${tdCls} font-medium`}>{row.vendor_name}</td>
        <td className={`${tdCls} text-stone-500`}>{row.reason}</td>
        <td className={tdNumCls}>{row.line_count}</td>
        <td className={`${tdNumCls} font-semibold`}>{formatMoneyString(row.total)}</td>
        <td className={`${tdCls} text-right`}>
          <button type="button" onClick={onToggle} className="min-h-[40px] px-2.5 text-xs font-semibold text-emerald-700 hover:underline">
            {open ? 'close' : 'Credit note…'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="border-b border-rule-soft px-3 py-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="block">
                <span className={fieldLabelCls}>Their credit note number</span>
                <input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  maxLength={120}
                  placeholder="CN/2026/114"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Taken off which bill? (usually a later one)</span>
                <select value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)} className={selectCls}>
                  <option value="">— not yet set against a bill —</option>
                  {bills.map((b) => (
                    <option key={b.id} value={b.id}>
                      {fmtDate(b.bill_date)} · {b.bill_no ?? b.doc_no ?? 'no bill no'} ·{' '}
                      {formatMoneyString(b.bill_total)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || ref.trim() === ''}
                className={`${btnGhostCls} disabled:cursor-not-allowed disabled:text-stone-400`}
              >
                {saving ? 'Saving…' : 'Record'}
              </button>
            </div>
            {bills.length === 0 && (
              <p className="mt-2 text-xs text-stone-500">
                No bills on file for this vendor yet — record the number now and set the bill when the credit
                actually lands on one.
              </p>
            )}
            {error !== null && (
              <p role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-sm text-red-800">
                {error}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
