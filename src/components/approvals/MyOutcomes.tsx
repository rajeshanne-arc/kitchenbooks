'use client'

// WHAT HAPPENED TO THE ONES HE RAISED.
//
// He asked for a vendor to be paid because he had promised that vendor
// something. Until now the request left his hands and he never heard again —
// so he chased a payment that had already gone, or kept promising against one
// that had been refused.
//
// AND THE HALF THAT WAS STILL MISSING: THE ONES NOTHING HAS HAPPENED TO YET.
// This panel showed refused and paid, so a request sitting with the owner for
// three days appeared on NO screen at all — which reads exactly like a request
// that was never made, and sends him to ask for it twice. "Still waiting" is
// first, because it is the only part he can act on.
//
// IT NAMES A PERSON AND A DATE, not a status. The next thing he does with a
// stalled request is walk up to somebody, and "with the owner since Mon 14 Sep
// · 4 days" is that; "PENDING" is a property of the request and tells him
// nothing about his morning.
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
import NameFigure from '@/components/NameFigure'
import BillScope from '@/components/approvals/BillScope'
import { acknowledgeRequest, cancelApproval } from '@/server/approvals-actions'
import type { OutcomeRow, WaitingRow } from '@/server/approvals-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDateTime, fmtDayDate } from '@/lib/format'
import { heldText, holder, worthChasing } from '@/lib/waiting'
import { cardCls, sectionHeadCls } from '@/components/ui'

export default function MyOutcomes({
  waiting,
  rows,
}: {
  waiting: WaitingRow[]
  rows: OutcomeRow[]
}) {
  const unnoted = rows.filter((r) => r.needs_noting).length
  // THE BORDER FOLLOWS THE REFUSAL, NOT THE WAITING. A request that has been
  // with the owner two days is the ordinary way this works; a refusal is a
  // thing he has to go and say to a vendor. Tinting the card for both would
  // make the amber mean "there is a card here".
  return (
    <section className={`${cardCls} mb-4 ${unnoted > 0 ? 'border-amber-300' : ''}`}>
      <h2 className={sectionHeadCls}>What happened to yours</h2>

      {waiting.length > 0 && (
        <>
          <p className="mt-2 font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-stone-400">
            Still waiting
          </p>
          <ul className="mt-1 divide-y divide-rule-soft">
            {waiting.map((r) => (
              <Waiting key={r.id} row={r} />
            ))}
          </ul>
        </>
      )}

      {rows.length > 0 && (
        <>
          {/* LABELLED ONLY WHEN THERE IS SOMETHING ABOVE IT TO TELL IT APART
              FROM. On its own the card's own heading already says what these
              are, and a second caption would be a word to read for nothing. */}
          {waiting.length > 0 && (
            <p className="mt-3 font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-stone-400">
              Decided
            </p>
          )}
          <ul className={`${waiting.length > 0 ? 'mt-1' : 'mt-2'} divide-y divide-rule-soft`}>
            {rows.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/**
 * ONE THAT HAS NOT COME BACK YET.
 *
 * WITHDRAW IS OFFERED ONLY WHILE `pending`, and that is the server's rule
 * showing through rather than a second one: `WITHDRAW_FROM.raiser` is
 * ['pending'], and once an owner has approved it, unmaking that decision is
 * the owner's act on his own screen. A button that refuses when tapped is
 * worse than no button — it is a refusal arriving after the work.
 *
 * TWO TAPS, AND THE REASON IS OPTIONAL. Nobody downstream needs to be told why
 * somebody stopped asking for something, and demanding a sentence would make
 * changing your mind cost more than the request did. The confirm step is there
 * because the act is quiet: after it there is no negative twin to read, only a
 * row that is gone.
 */
function Waiting({ row }: { row: WaitingRow }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  async function withdraw() {
    setBusy(true)
    const r = await cancelApproval(row.id, reason)
    setBusy(false)
    // THE ROW LEAVES, so the acknowledgement cannot live inside it: this
    // component unmounts on the next render and any state in it goes too. The
    // toast is bottom-anchored in the root layout and survives the refresh,
    // and it carries the numbers — what the vendor is still owed, and whether
    // anybody else is holding a request for them.
    toast(r.ok ? r.message : r.error, r.ok ? 'ok' : 'error')
    if (r.ok) router.refresh()
    else setOpen(false)
  }

  const chase = worthChasing(row.held_days)
  return (
    <li className="py-2.5">
      <NameFigure
        name={row.from_name ?? row.from_code ?? 'a request'}
        figure={row.amount === null ? null : formatMoneyString(row.amount)}
        after={
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-600">
            with {holder(row.assigned_to)}
          </span>
        }
      />
      <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-stone-400">
        <BillScope kind={row.kind} from={row.bills_from} to={row.bills_to} snapshot={row.snapshot} />
        {/* THE DATE AND THE DURATION, BOTH. The weekday is what a person says
            out loud and the date is what stops it being ambiguous a fortnight
            later; the count is the half somebody acts on. Amber AGREES with
            the words and never carries the meaning alone. */}
        <span className={chase ? 'font-semibold text-amber-700' : undefined}>
          since {fmtDayDate(row.held_since)} · {heldText(row.held_days)}
        </span>
      </p>
      <p className="mt-1 text-[13px] text-stone-500">you asked: “{row.reason}”</p>

      {row.status === 'pending' && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 min-h-[40px] rounded-lg border border-rule px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
        >
          Withdraw
        </button>
      )}

      {row.status === 'pending' && open && (
        <div className="mt-2 rounded-lg border border-rule bg-field px-3 py-2.5">
          <p className="text-[13px] text-stone-700">
            Taking it back stops anybody acting on it. Nothing is paid and nothing changes for the
            vendor — they are still owed what they are owed.
          </p>
          <label className="mt-2 block text-xs text-stone-500">
            Why, if you want to say (optional)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              placeholder="paid in cash at the door"
              className="mt-1 block w-full rounded-lg border border-rule bg-white px-2.5 py-2 text-sm text-stone-900"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={withdraw}
              disabled={busy}
              className="min-h-[40px] rounded-lg border border-red-700 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              {busy ? 'Withdrawing…' : 'Withdraw it'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="min-h-[40px] rounded-lg border border-rule px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"
            >
              Keep it
            </button>
          </div>
        </div>
      )}
    </li>
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
      {/* THE SAME SHAPE AS THE ROUTED QUEUE. The outcome chip rides beside the
          NAME rather than beside the figure — a badge in the right-hand column
          would shunt the amount sideways on whichever rows happened to have
          one, and the column stops being a column. */}
      <NameFigure
        name={what}
        figure={row.amount === null ? null : formatMoneyString(row.amount)}
        after={
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              refused
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {chip}
          </span>
        }
      />
      <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-stone-400">
        <BillScope kind={row.kind} from={row.bills_from} to={row.bills_to} snapshot={row.snapshot} />
        <span>
          {row.decided_by ?? row.last_by ?? 'somebody'} ·{' '}
          {fmtDateTime(row.applied_at ?? row.decided_at ?? row.requested_at)}
        </span>
      </p>
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
    // AN ADVANCE IS NOT A PAYMENT AND MUST NOT BORROW ITS WORDS. "Paid —
    // stop chasing it" is true of a bill being settled and false of money
    // lent: the whole point of an advance is that it comes BACK, so the
    // sentence has to say where from.
    //
    // THE NAME COMES FROM THE SUBJECT'S OWN TABLE. The query joined items and
    // vendors only, so a staff-subject advance read as "the person or vendor
    // it was for" — honest, and still nobody's name on a screen about
    // somebody's pay. `staff` is joined now. The fallback stays for the case
    // the join cannot cover: a subject row that will not read, which is a
    // failed lookup rather than a request about nobody.
    case 'advance':
      return {
        chip: refused ? 'not advanced' : 'advanced',
        what: row.from_name ?? row.from_code ?? 'the person or vendor it was for',
        nothingToDo:
          row.entity_type === 'vendor'
            ? `Paid as an advance${mine ? ' by you' : ''}. It sits as credit with them until they bill against it.`
            : `Advanced${mine ? ' by you' : ''}. It comes back out of pay, not by being chased.`,
      }
    // 'OTHER' IS THE CATCH-ALL KIND AND HAS ONE REAL USE: writing off what
    // somebody owes. Its subject says which — an 'other' about anything else
    // still falls to the neutral default, which is the point of a catch-all.
    case 'other':
      // An 'other' about anything else keeps the neutral default, which is the
      // point of a catch-all: a wrong sentence reads as a fact and a dull one
      // reads as a gap somebody can fill.
      return row.entity_type !== 'staff'
        ? {
            chip: refused ? 'refused' : 'done',
            what: row.from_name ?? row.from_code ?? 'a request',
            nothingToDo: `This was applied${mine ? ' by you' : ''}. Nothing is waiting on you.`,
          }
        : {
            chip: refused ? 'not written off' : 'written off',
            what: row.from_name ?? 'somebody',
            nothingToDo: `Written off${mine ? ' by you' : ''}. The money stays on the record as given and is now an expense — the business has lost it, and they can be retired.`,
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
