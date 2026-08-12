'use client'

// The two lists, side by side: what the provider says on the left, what the
// books say on the right. Pick one from each and say they are the same
// event.
//
// HELP THE EYE, DO NOT DECIDE. Where exactly one movement carries the same
// amount within a few days of a line — and that movement is the only
// candidate for that line, and that line the only candidate for it — both
// wear a LIKELY mark. It is a hint and nothing else: nothing is
// pre-selected, nothing is matched automatically, and the mark disappears
// the moment two rows could plausibly be the same one. An auto-match that is
// right 95 times and silently wrong the 96th is worse than no help at all,
// because the 96th is the one nobody looks at.
//
// AMOUNTS ARE NOT REQUIRED TO AGREE. A bank fee folded into a transfer, a
// rounding on a settlement, a part payment — those are real, and an
// accountant matches them knowingly. So the difference is stated in figures
// before the button rather than being refused: the screen shows, the human
// decides.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StatementLineRow, UnmatchedMovementRow } from '@/lib/types'
import { matchStatementLine } from '@/server/reconciliation-actions'
import { decimalStringToPaise, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty from '@/components/Honesty'
import { toast } from '@/components/Toasts'
import {
  btnCls,
  cardCls,
  docNoCls,
  fieldLabelCls,
  inputCls,
  moneyCls,
  sectionHeadCls,
} from '@/components/ui'

/** How far apart a statement line and a movement may sit and still be worth
 *  pointing at. Banks post a day or two late and a weekend stretches it. */
const WINDOW_DAYS = 4

const movementKey = (m: UnmatchedMovementRow) => `${m.entity_type}:${m.entity_id}`

const dayGap = (a: string, b: string) =>
  Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)

const rowCls =
  'block w-full rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/30'

export default function MatchBoard({
  lines,
  movements,
  booksTotal,
  accountName,
}: {
  lines: StatementLineRow[]
  movements: UnmatchedMovementRow[]
  /** every entry the books hold for this account, placed or not. An empty
   *  right-hand column means two opposite things and this tells them apart. */
  booksTotal: number
  accountName: string
}) {
  const router = useRouter()
  const [lineId, setLineId] = useState('')
  const [movement, setMovement] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // The mutual-uniqueness pass. A candidate set of one on BOTH sides is the
  // only case where pointing at a row is help rather than a guess.
  const { lineHint, movementHint } = useMemo(() => {
    const byLine = new Map<string, string[]>()
    const byMovement = new Map<string, string[]>()
    for (const l of lines) {
      const paise = decimalStringToPaise(l.amount)
      const hits = movements.filter(
        (m) => decimalStringToPaise(m.amount) === paise && dayGap(l.stmt_date, m.move_date) <= WINDOW_DAYS,
      )
      byLine.set(
        l.statement_line_id,
        hits.map((m) => movementKey(m)),
      )
      for (const m of hits) {
        const k = movementKey(m)
        byMovement.set(k, [...(byMovement.get(k) ?? []), l.statement_line_id])
      }
    }
    const lineHint = new Map<string, string>()
    const movementHint = new Map<string, string>()
    for (const [id, keys] of byLine) {
      if (keys.length !== 1) continue
      const k = keys[0]
      if ((byMovement.get(k) ?? []).length !== 1) continue
      lineHint.set(id, k)
      movementHint.set(k, id)
    }
    return { lineHint, movementHint }
  }, [lines, movements])

  const chosenLine = lines.find((l) => l.statement_line_id === lineId) ?? null
  const chosenMovement = movements.find((m) => movementKey(m) === movement) ?? null
  const difference =
    chosenLine !== null && chosenMovement !== null
      ? decimalStringToPaise(chosenLine.amount) - decimalStringToPaise(chosenMovement.amount)
      : 0

  async function save() {
    if (busy || chosenLine === null || chosenMovement === null) return
    setBusy(true)
    try {
      const res = await matchStatementLine({
        statementLineId: chosenLine.statement_line_id,
        entityType: chosenMovement.entity_type,
        entityId: chosenMovement.entity_id,
        note: note.trim(),
      })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      toast('Matched', 'ok')
      setLineId('')
      setMovement('')
      setNote('')
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was matched.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Match</h2>
        <span className="font-mono text-[10px] text-stone-400">
          unmatched_statement_lines · unmatched_movements
        </span>
      </div>
      <p className="mt-1 text-xs text-stone-500">
        One row from each side, then say they are the same event. A LIKELY mark means one movement
        on {accountName} carries that exact amount within {WINDOW_DAYS} days and nothing else could
        be it — it is a pointer, never a decision, and nothing is selected for you.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* left: the provider's claim */}
        <div>
          <h3 className={sectionHeadCls}>On the statement · {lines.length}</h3>
          <div className="mt-1.5 max-h-[26rem] space-y-1.5 overflow-y-auto pr-0.5">
            {lines.map((l) => {
              const selected = l.statement_line_id === lineId
              const hinted = lineHint.has(l.statement_line_id)
              const amount = decimalStringToPaise(l.amount)
              return (
                <button
                  key={l.statement_line_id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setLineId(selected ? '' : l.statement_line_id)}
                  className={`${rowCls} ${
                    selected
                      ? 'border-emerald-700 bg-emerald-50/60'
                      : hinted
                        ? 'border-amber-300 bg-cell hover:border-amber-400'
                        : 'border-rule bg-cell hover:border-stone-400'
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[11px] text-stone-500">{fmtDate(l.stmt_date)}</span>
                    <span className={`${moneyCls} text-sm ${amount < 0 ? 'text-red-700' : 'text-stone-900'}`}>
                      {formatPaise(amount)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-stone-800">
                    {l.description ?? <span className="text-stone-400">no description</span>}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    {l.reference !== null && <span className={docNoCls}>{l.reference}</span>}
                    {hinted && (
                      <span className="rounded-full border border-amber-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800">
                        likely
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* right: what the books already hold */}
        <div>
          <h3 className={sectionHeadCls}>In the books · {movements.length}</h3>
          {movements.length === 0 && booksTotal === 0 ? (
            // NOT "all matched" — nothing was ever matched. Every entry made
            // before money accounts existed carries no account, so this side
            // is empty for a reason that has nothing to do with this
            // statement, and saying otherwise would be a flat untruth on the
            // first screen the accountant opens.
            <div className="mt-1.5">
              <Honesty verdict="no entries name this account">
                Nothing in the books is recorded against {accountName} — not matched, not missing,
                simply never tied to an account. Entries made before money accounts existed carry
                none, and nothing has been backfilled. So the left-hand side cannot be placed
                against anything yet, and that is a gap in what was entered, not a finding about
                this statement.
              </Honesty>
            </div>
          ) : movements.length === 0 ? (
            <p className="mt-1.5 text-sm text-stone-700">
              All {booksTotal} {booksTotal === 1 ? 'entry' : 'entries'} the books hold for{' '}
              {accountName} {booksTotal === 1 ? 'has' : 'have'} already been matched to something. If
              statement lines are still standing on the left, they are money the provider knows
              about that has never been entered here.
            </p>
          ) : (
            <div className="mt-1.5 max-h-[26rem] space-y-1.5 overflow-y-auto pr-0.5">
              {movements.map((m) => {
                const k = movementKey(m)
                const selected = k === movement
                const hinted = movementHint.has(k)
                const amount = decimalStringToPaise(m.amount)
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setMovement(selected ? '' : k)}
                    className={`${rowCls} ${
                      selected
                        ? 'border-emerald-700 bg-emerald-50/60'
                        : hinted
                          ? 'border-amber-300 bg-cell hover:border-amber-400'
                          : 'border-rule bg-cell hover:border-stone-400'
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[11px] text-stone-500">{fmtDate(m.move_date)}</span>
                      <span className={`${moneyCls} text-sm ${amount < 0 ? 'text-red-700' : 'text-stone-900'}`}>
                        {formatPaise(amount)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-stone-800">
                      {m.kind} — {m.party ?? 'no party named'}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      {m.doc_no !== null && <span className={docNoCls}>{m.doc_no}</span>}
                      {hinted && (
                        <span className="rounded-full border border-amber-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800">
                          likely
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-rule-soft pt-3">
        {chosenLine === null || chosenMovement === null ? (
          <p className="text-sm text-stone-500">
            Pick a row on each side. Nothing is written until you press the button, and the two
            figures are shown against each other first.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-rule bg-stone-50 px-3 py-2">
                <span className={fieldLabelCls}>Statement says</span>
                <span className={`block ${moneyCls} text-[15px] text-stone-900`}>
                  {formatPaise(decimalStringToPaise(chosenLine.amount))}
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  {fmtDate(chosenLine.stmt_date)} · {chosenLine.description ?? 'no description'}
                </span>
              </div>
              <div className="rounded-xl border border-rule bg-stone-50 px-3 py-2">
                <span className={fieldLabelCls}>Books say</span>
                <span className={`block ${moneyCls} text-[15px] text-stone-900`}>
                  {formatPaise(decimalStringToPaise(chosenMovement.amount))}
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  {fmtDate(chosenMovement.move_date)} · {chosenMovement.kind} ·{' '}
                  {chosenMovement.party ?? 'no party named'}
                </span>
              </div>
            </div>

            {difference !== 0 && (
              <p className="mt-2 text-sm text-red-800">
                The two figures differ by{' '}
                <span className={`${moneyCls} font-semibold`}>{formatPaise(Math.abs(difference))}</span>. That
                can be right — a fee taken out of a transfer, a part payment — but it is not
                checked by anything, so match these two only if you know why they differ.
              </p>
            )}

            <label className="mt-3 block">
              <span className={fieldLabelCls}>Note (optional)</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                placeholder="why these two are the same event"
                className={inputCls}
              />
            </label>

            {/* A match is an ASSERTION, not an event: it records that a
                human believes two rows are the same transaction. Being
                wrong about that is a mistake rather than history, so it is
                undone rather than reversed — the one place in the books
                where taking something back is the honest answer. */}
            <p className="mt-3 text-sm text-stone-600">
              A match says these two rows are the same transaction. If that turns out to be wrong,
              unmatch it from the matched list below — a wrong match is a mistake, not history, and
              there is nothing to preserve in it.
            </p>

            <button type="button" disabled={busy} onClick={() => void save()} className={`${btnCls} mt-2`}>
              {busy ? 'Matching…' : 'Match these two'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
