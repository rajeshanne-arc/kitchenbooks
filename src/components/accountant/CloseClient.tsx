'use client'

// Closing a period, and the one rule that makes the query loop matter:
// A PERIOD CANNOT CLOSE WHILE A QUERY IS OPEN.
//
// The block is shown BEFORE the form, not discovered by pressing save. An
// accountant should be able to see at a glance what stands between them and
// a closed month, and the list is that answer — with the questions named,
// not just counted.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ClosedPeriodRow, QueryRow } from '@/lib/types'
import { closePeriod, reopenPeriod } from '@/server/accountant-actions'
import { entityLabel } from '@/lib/query-entities'
import { fmtDate } from '@/lib/format'
import {
  btnCls,
  cardCls,
  fieldLabelCls,
  inputCls,
  sectionHeadCls,
} from '@/components/ui'
import Honesty from '@/components/Honesty'
import { toast } from '@/components/Toasts'

export default function CloseClient({
  blocking,
  closed,
  defaultStart,
  defaultEnd,
}: {
  blocking: QueryRow[]
  closed: ClosedPeriodRow[]
  defaultStart: string
  defaultEnd: string
}) {
  const router = useRouter()
  const [periodStart, setPeriodStart] = useState(defaultStart)
  const [periodEnd, setPeriodEnd] = useState(defaultEnd)
  const [note, setNote] = useState('')
  const [reopening, setReopening] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const blocked = blocking.length > 0

  async function close() {
    if (busy || blocked) return
    setBusy(true)
    try {
      const res = await closePeriod({ periodStart, periodEnd, note })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      toast('Period closed', 'ok')
      setNote('')
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was closed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function reopen(start: string) {
    if (busy || reason.trim() === '') return
    setBusy(true)
    try {
      const res = await reopenPeriod(start, reason)
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      toast('Reopened', 'ok')
      setReopening(null)
      setReason('')
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was reopened.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {blocked && (
        <Honesty
          level="alarm"
          verdict="cannot close"
          meter={{ filled: 0, total: blocking.length, unit: 'queries resolved' }}
        >
          {blocking.length} {blocking.length === 1 ? 'question is' : 'questions are'} still open. A month
          that closes over an unanswered question closes over a wrong number — resolve{' '}
          {blocking.length === 1 ? 'it' : 'them'} on Review first.
        </Honesty>
      )}

      {blocked && (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>In the way</h2>
          <ul className="mt-2 divide-y divide-rule-soft">
            {blocking.map((q) => (
              <li key={q.id} className="py-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                  {entityLabel(q.entity_type)} · asked of the {q.assigned_role}
                  {q.status === 'answered' && ' · answered, not yet resolved'}
                </p>
                <p className="mt-0.5 text-sm text-stone-900">{q.question}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Close a period</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>From</span>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>To</span>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className={fieldLabelCls}>Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="anything the next person should know"
            className={inputCls}
          />
        </label>
        <p className="mt-2 text-xs text-stone-500">
          Closing does not lock the events — nothing in this app was ever editable. It records that the
          month was reviewed and settled, and by whom.
        </p>
        <button
          type="button"
          disabled={busy || blocked || periodStart === '' || periodEnd === ''}
          onClick={() => void close()}
          className={`${btnCls} mt-3`}
        >
          {busy ? 'Closing…' : blocked ? 'Blocked by open questions' : 'Close this period'}
        </button>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Closed</h2>
        {closed.length === 0 ? (
          <p className="mt-1.5 text-sm text-stone-700">No period has been closed yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule-soft">
            {closed.map((c) => (
              <li key={c.period_start} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-stone-900">
                    {fmtDate(c.period_start)} — {fmtDate(c.period_end)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setReopening(reopening === c.period_start ? null : c.period_start)}
                    className="shrink-0 rounded-lg border border-rule px-2 py-1 text-xs font-medium text-stone-500 hover:border-amber-300 hover:text-amber-800"
                  >
                    reopen
                  </button>
                </div>
                <p className="text-[11px] text-stone-400">
                  closed by {c.closed_by ?? '—'} on {fmtDate(c.closed_at.slice(0, 10))}
                </p>
                {reopening === c.period_start && (
                  <div className="mt-1.5 flex items-start gap-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={500}
                      placeholder="Why is it reopening? This is kept."
                      className={`${inputCls} flex-1`}
                    />
                    <button
                      type="button"
                      disabled={busy || reason.trim() === ''}
                      onClick={() => void reopen(c.period_start)}
                      className={`${btnCls} shrink-0 px-3 py-2 text-sm`}
                    >
                      Reopen
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
