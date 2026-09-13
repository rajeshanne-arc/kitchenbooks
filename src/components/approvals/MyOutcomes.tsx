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
//   APPLIED  is news, not work. No badge, no button, and it drops off on its
//            own as newer entries push it down. Badging good news trains
//            somebody to clear badges rather than read them.
//
// THE WORDS COME FROM THE KIND, NEVER FROM THE STATUS ALONE. `applied` was
// rendered as PAID for every kind, so two discards read "PAID · CHICKEN BONES
// — Paid, nothing for you to do, stop chasing it" when what happened was that
// a duplicate code was closed. A kind with no sentence of its own says
// something NEUTRAL — it never borrows another kind's, because borrowed
// vocabulary is not vague, it is wrong.
//
// AND FROM WHO DECIDED. "Stop chasing it" addresses somebody waiting on
// another person. The owner raises a discard, approves it and applies it; he
// is downstream of nothing. When the raiser and the decider are the same
// person this panel is a RECEIPT, and it says so.

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
  const { chip, what, nothingToDo } = words(row)
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
          {chip}
        </span>
        <span className="font-medium text-stone-900">{what}</span>
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
      {!refused && <p className="mt-1 text-xs text-stone-500">{nothingToDo}</p>}
    </li>
  )
}

/**
 * WHAT THIS ROW IS, IN ITS OWN KIND'S WORDS.
 *
 * `status` says whether it happened; only `kind` says WHAT happened. Reading
 * `applied` as "paid" is true for exactly one kind and wrong for the rest —
 * it put "PAID · TRIGGER SPRAY BOTTLE" on a discard of a duplicate code.
 *
 * The default arm is deliberately colourless. A kind this app has not written
 * a sentence for should say something true and dull rather than borrow the
 * nearest one: a wrong sentence reads as a fact, and a dull one reads as a
 * gap somebody can fill.
 */
function words(row: OutcomeRow): { chip: string; what: string; nothingToDo: string } {
  const refused = row.status === 'refused'
  // A RECEIPT, NOT NEWS. He raised it, decided it and applied it; "stop
  // chasing it" would be telling him about his own act.
  const mine = row.decided_it_himself
  switch (row.kind) {
    case 'payment':
      return {
        chip: refused ? 'refused' : 'paid',
        what: row.from_name ?? 'a vendor',
        nothingToDo: mine
          ? 'You paid it yourself — this is the record.'
          : 'Paid — nothing for you to do. Stop chasing it.',
      }
    case 'discard':
      return {
        chip: refused ? 'not discarded' : 'discarded',
        what: `${row.from_code ?? 'a code'}${row.from_name === null ? '' : ` · ${row.from_name}`}`,
        nothingToDo: `Discarded — ${row.from_code ?? 'the code'} is closed${
          mine ? ', by you' : ''
        }. It stays searchable and nothing can be entered against it.`,
      }
    case 'merge':
      return {
        chip: refused ? 'not merged' : 'merged',
        what: `${row.from_code ?? 'a code'} → ${row.to_code ?? 'another'}`,
        nothingToDo: `${row.from_code ?? 'The old code'} now resolves to ${
          row.to_code ?? 'the survivor'
        }${mine ? ', by you' : ''}. Looking up the old one still answers.`,
      }
    case 'reopen_period':
      return {
        chip: refused ? 'not reopened' : 'reopened',
        what: 'a closed month',
        nothingToDo: `The month is open again${mine ? ', by you' : ''}.`,
      }
    default:
      return {
        chip: refused ? 'refused' : 'done',
        what: row.from_name ?? row.from_code ?? 'a request',
        nothingToDo: `This was applied${mine ? ' by you' : ''}. Nothing is waiting on you.`,
      }
  }
}
