'use client'

// WHAT HAPPENED TO THE ONES HE RAISED.
//
// He asked for a vendor to be paid because he had promised that vendor
// something. Until now the request left his hands and he never heard again —
// so he chased a payment that had already gone, or kept promising against one
// that had been refused.
//
// TWO OUTCOMES AND ONE BUTTON, and the asymmetry is the design:
//
//   REFUSED  changes what he has to say to somebody, so it stays on his list
//            and carries the badge until he taps Noted. The reason the owner
//            typed is the whole of what he is being shown.
//   PAID     is news, not work. No badge, no button, and it drops off on its
//            own as newer entries push it down. Badging good news trains
//            somebody to clear badges rather than read them.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/Toasts'
import { acknowledgeRequest } from '@/server/approvals-actions'
import type { OutcomeRow } from '@/server/approvals-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDateTime } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'

export default function MyOutcomes({ rows }: { rows: OutcomeRow[] }) {
  const unnoted = rows.filter((r) => r.needs_noting).length
  return (
    <section className={`${cardCls} mb-4 ${unnoted > 0 ? 'border-amber-300' : ''}`}>
      <h2 className={sectionHeadCls}>What happened to yours</h2>
      <ul className="mt-2 divide-y divide-rule-soft">
        {rows.map((r) => (
          <Row key={r.id} row={r} />
        ))}
      </ul>
    </section>
  )
}

function Row({ row }: { row: OutcomeRow }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function note() {
    setBusy(true)
    const r = await acknowledgeRequest(row.id)
    setBusy(false)
    toast(r.ok ? r.message : r.error, r.ok ? 'ok' : 'error')
    router.refresh()
  }

  const refused = row.status === 'refused'
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            refused
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {refused ? 'refused' : 'paid'}
        </span>
        <span className="font-medium text-stone-900">{row.from_name ?? 'a vendor'}</span>
        {row.amount !== null && (
          <span className="font-mono text-stone-800">{formatMoneyString(row.amount)}</span>
        )}
        <span className="ml-auto text-xs text-stone-400">
          {row.decided_by ?? row.last_by ?? 'somebody'} ·{' '}
          {fmtDateTime(row.applied_at ?? row.decided_at ?? row.requested_at)}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-stone-500">you asked: “{row.reason}”</p>

      {/* THE REASON IS THE WHOLE OF WHAT HE IS BEING SHOWN. A refusal with no
          sentence is a status, and a status tells him nothing he can say to
          the vendor — which is why the server refuses a blank one. */}
      {refused && row.decision_note !== null && (
        <p className="mt-1 rounded-lg border border-rule bg-field px-3 py-2 text-sm text-stone-800">
          “{row.decision_note}”
        </p>
      )}

      {row.needs_noting && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={note}
            disabled={busy}
            className="min-h-[40px] rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            {busy ? 'Noting…' : 'Noted'}
          </button>
          <span className="text-xs text-stone-500">
            It stays refused and the reason stays on the record — this only takes it off your list.
          </span>
        </div>
      )}

      {/* NO BUTTON ON GOOD NEWS, and the sentence says why there is nothing
          to do rather than leaving a reader looking for one. */}
      {!refused && (
        <p className="mt-1 text-xs text-stone-500">
          Paid — nothing for you to do. Stop chasing it.
        </p>
      )}
    </li>
  )
}
