'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { decideStockAdjustmentApproval } from '@/server/adjustment-actions'
import { formatMoneyString } from '@/lib/money'
import { btnCls, btnGhostCls, cardCls, inputCls, sectionHeadCls } from '@/components/ui'
import type { StockAdjustmentApprovalRow } from '@/lib/types'

export default function StockAdjustmentApprovalsQueue({ rows }: { rows: StockAdjustmentApprovalRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  async function decide(row: StockAdjustmentApprovalRow, decision: 'approved' | 'refused') {
    const note = notes[row.id] ?? ''
    if (decision === 'refused' && note.trim() === '') return
    setBusy(row.id)
    setError(null)
    try {
      const result = await decideStockAdjustmentApproval(row.id, decision, note)
      if (result.ok) router.refresh()
      else setError(result.error)
    } catch {
      setError('Could not reach the server — nothing was changed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Stock corrections waiting for approval</h2>
      <div className="mt-2 divide-y divide-rule-soft">
        {rows.map((row) => (
          <div key={row.id} className="py-3">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-stone-900">{row.adj_date}</span>
              <span className="text-sm text-stone-600">{row.lines} line(s) · {formatMoneyString(row.total_value)}</span>
              <span className="ml-auto text-xs text-stone-500">requested by {row.requested_by ?? '—'}</span>
            </div>
            <p className="mt-1 text-sm text-stone-700">{row.reason}{row.note ? ` · ${row.note}` : ''}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input value={notes[row.id] ?? ''} onChange={(e) => setNotes((all) => ({ ...all, [row.id]: e.target.value }))} placeholder="Decision note (required to refuse)" maxLength={300} className={`${inputCls} min-w-[240px] flex-1`} />
              <button type="button" disabled={busy !== null} onClick={() => void decide(row, 'approved')} className={btnCls}>{busy === row.id ? 'Saving…' : 'Approve'}</button>
              <button type="button" disabled={busy !== null || (notes[row.id] ?? '').trim() === ''} onClick={() => void decide(row, 'refused')} className={btnGhostCls}>Refuse</button>
            </div>
          </div>
        ))}
      </div>
      {error !== null && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  )
}
