'use client'

// Closing a period, and the one rule that makes the query loop matter:
// A PERIOD CANNOT CLOSE WHILE A QUERY IS OPEN.
//
// The block is shown BEFORE the form, not discovered by pressing save. An
// accountant should be able to see at a glance what stands between them and
// a closed month, and the list is that answer — with the questions named,
// not just counted.
//
// The staff fund sits here for the same reason: a month whose staff money has
// not been squared is a month that is not finished, and the accountant is the
// one who squares it.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  ClosedPeriodRow,
  MoneyAccount,
  QueryRow,
  StaffFundBalance,
  StaffFundInput,
} from '@/lib/types'
import { closePeriod, reopenPeriod, saveStaffFundMovement } from '@/server/accountant-actions'
import { requestReopen } from '@/server/approvals-actions'
import { entityLabel } from '@/lib/query-entities'
import { fmtDate } from '@/lib/format'
import { decimalStringToPaise, formatMoneyString, parseMoney } from '@/lib/money'
import AccountPicker from '@/components/accounts/AccountPicker'
import {
  btnCls,
  cardCls,
  fieldLabelCls,
  heroNumCls,
  inputCls,
  moneyCls,
  numCls,
  sectionHeadCls,
} from '@/components/ui'
import Honesty from '@/components/Honesty'
import { toast } from '@/components/Toasts'
import SaveAck from '@/components/SaveAck'

/** derived, so the toggle cannot drift from what the action accepts */
type Direction = StaffFundInput['direction']

export default function CloseClient({
  blocking,
  closed,
  defaultStart,
  defaultEnd,
  fund,
  accounts,
  today,
  canReopenDirectly,
}: {
  blocking: QueryRow[]
  closed: ClosedPeriodRow[]
  defaultStart: string
  defaultEnd: string
  fund: StaffFundBalance
  accounts: MoneyAccount[]
  today: string
  /** the owner reopens; everybody else raises a request the owner decides */
  canReopenDirectly: boolean
}) {
  const router = useRouter()
  const [periodStart, setPeriodStart] = useState(defaultStart)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)
  const [periodEnd, setPeriodEnd] = useState(defaultEnd)
  const [note, setNote] = useState('')
  const [reopening, setReopening] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  // the fund keeps its own busy flag — a movement saving must not grey out
  // the close button beside it
  const [moveDate, setMoveDate] = useState(today)
  // 'distributed' because collection is usually automatic and handing the
  // money over is the act a person performs and then comes here to record
  const [direction, setDirection] = useState<Direction>('distributed')
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState('')
  const [accountId, setAccountId] = useState('')
  const [moveNote, setMoveNote] = useState('')
  const [fundBusy, setFundBusy] = useState(false)

  const blocked = blocking.length > 0

  const owed = decimalStringToPaise(fund.owed_to_staff)
  const untouched =
    decimalStringToPaise(fund.collected) === 0 && decimalStringToPaise(fund.distributed) === 0

  // four facts, four sentences: a settled fund is not an untouched one, and a
  // negative balance is emphatically not money the staff owe back
  const caption = untouched
    ? 'nothing held for the staff yet'
    : owed < 0
      ? 'handed out beyond what was collected'
      : owed === 0
        ? 'everything collected has been handed over'
        : 'still owed to the staff'

  const canRecord =
    !fundBusy && moveDate !== '' && (parseMoney(amount.trim()) ?? 0) > 0 && accountId !== ''

  async function close() {
    if (busy || blocked) return
    setBusy(true)
    try {
      const res = await closePeriod({ periodStart, periodEnd, note })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
setAck({ headline: `${fmtDate(periodStart)} – ${fmtDate(periodEnd)} closed`, sub: 'No query was left open — a period cannot close while one is, which is what makes the deadline mean anything.' })
      toast(`${fmtDate(periodStart)} – ${fmtDate(periodEnd)} closed`, 'ok')
      setNote('')
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was closed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * THE OWNER REOPENS; EVERYONE ELSE ASKS.
   *
   * What a reopen destroys is not in this database. The month may already have
   * gone to a CA, and nothing here knows that — so for anybody but the owner
   * this raises a request carrying the reason, and the owner decides. The
   * owner's own route stays direct: they would otherwise be asking themselves.
   */
  async function reopen(start: string, id: string) {
    if (busy || reason.trim() === '') return
    setBusy(true)
    try {
      const res = canReopenDirectly
        ? await reopenPeriod(start, reason)
        : await requestReopen({ periodCloseId: id, reason })
      if (!canReopenDirectly) {
        if (!res.ok) {
          toast(res.error, 'error')
          return
        }
        setAck({
          headline: 'Sent to the owner — nothing has reopened yet',
          sub: 'A closed month coming back is theirs to allow: it may already have been handed on, and this app cannot know that. Your reason goes with it.',
        })
        setReopening(null)
        setReason('')
        router.refresh()
        return
      }
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
setAck({ headline: `${fmtDate(periodStart)} – ${fmtDate(periodEnd)} reopened`, sub: 'It stays on the record as reopened. Nothing is erased — a period that was closed and opened again is a thing somebody did.' })
      toast(`${fmtDate(periodStart)} – ${fmtDate(periodEnd)} reopened — it stays on the record as reopened`, 'ok')
      setReopening(null)
      setReason('')
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was reopened.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function recordMovement() {
    if (!canRecord) return
    setFundBusy(true)
    try {
      const res = await saveStaffFundMovement({
        date: moveDate,
        direction,
        amount: amount.trim(),
        source: source.trim(),
        accountId,
        note: moveNote.trim(),
      })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
setAck({ headline: direction === 'collected' ? 'Collection recorded' : 'Payout recorded', sub: 'The staff fund is a LIABILITY, not income — collected on behalf of the staff, less what has been handed to them.' })
      toast(direction === 'collected' ? 'Collection recorded' : 'Payout recorded', 'ok')
      setAmount('')
      setSource('')
      setMoveNote('')
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was recorded.', 'error')
    } finally {
      setFundBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {ack !== null && (
        <div className="mb-3">
          <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />
        </div>
      )}
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

      {/* The staff fund. Money held FOR the staff — never the restaurant's to
          earn, so it is a balance owed and not a line of income. The local
          word for it (service charge, tips, a pooled box) is a matter of
          where you are; the shape is the same everywhere, which is why the
          heading names none of them and `source` is free text. */}
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Staff fund</h2>
          <span className="font-mono text-[10px] text-stone-400">staff_fund_balance</span>
        </div>
        <p className="mt-1.5 text-sm text-stone-700">
          Money collected on behalf of the staff, less what has been handed to them. It is a
          liability — owed to them, never earned by the restaurant — so it belongs here and not in
          income. Whatever it is called locally, service charge or tips, this is the same balance.
        </p>

        <p className={`mt-3 text-[30px] ${heroNumCls} ${owed < 0 ? 'text-red-700' : 'text-stone-900'}`}>
          {formatMoneyString(fund.owed_to_staff)}
        </p>
        <p className="text-xs text-stone-500">{caption}</p>

        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-rule bg-paper px-3 py-2">
            <dt className="text-xs text-stone-500">Collected for them</dt>
            <dd className={`mt-0.5 text-[17px] ${moneyCls} text-stone-900`}>
              {formatMoneyString(fund.collected)}
            </dd>
          </div>
          <div className="rounded-xl border border-rule bg-paper px-3 py-2">
            <dt className="text-xs text-stone-500">Handed to them</dt>
            <dd className={`mt-0.5 text-[17px] ${moneyCls} text-stone-900`}>
              {formatMoneyString(fund.distributed)}
            </dd>
          </div>
        </dl>

        {owed < 0 && (
          <div className="mt-3">
            <Honesty level="alarm" verdict="more out than in">
              More has been handed to the staff than was ever collected for them. Either a
              collection has not been entered or a payout was recorded twice — the balance below
              zero is not a debt the staff owe back.
            </Honesty>
          </div>
        )}

        {untouched && (
          <p className="mt-3 text-xs text-stone-500">
            Nothing has been collected for the staff yet. That is the ordinary starting point — the
            fund only begins the first time money is taken in on their behalf.
          </p>
        )}

        <div className="mt-4 border-t border-rule-soft pt-3">
          <h3 className={sectionHeadCls}>Record a movement</h3>

          <div
            className="mt-2 grid grid-cols-2 gap-2"
            role="group"
            aria-label="Which way the money moved"
          >
            {(
              [
                { key: 'collected', title: 'Collected', sub: 'into the fund' },
                { key: 'distributed', title: 'Handed over', sub: 'out to the staff' },
              ] as const
            ).map((d) => (
              <button
                key={d.key}
                type="button"
                aria-pressed={direction === d.key}
                onClick={() => setDirection(d.key)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  direction === d.key
                    ? 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
                }`}
              >
                <span className="block text-[15px] font-semibold">{d.title}</span>
                <span
                  className={`block text-xs ${
                    direction === d.key ? 'text-emerald-100' : 'text-stone-500'
                  }`}
                >
                  {d.sub}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Date</span>
              <input
                type="date"
                value={moveDate}
                onChange={(e) => setMoveDate(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Amount</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                className={`${numCls} w-full text-right`}
              />
            </label>
          </div>

          <label className="mt-3 block">
            <span className={fieldLabelCls}>
              {direction === 'collected' ? 'Where it came from' : 'Who it went to'}
            </span>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              maxLength={120}
              placeholder={
                direction === 'collected'
                  ? 'what it was collected on'
                  : 'the person or the group who received it'
              }
              className={inputCls}
            />
          </label>

          <div className="mt-3">
            <AccountPicker
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
              label="Money account"
              hint={
                direction === 'collected'
                  ? 'the account this landed in'
                  : 'the account it was paid out of'
              }
            />
          </div>

          <label className="mt-3 block">
            <span className={fieldLabelCls}>Note (optional)</span>
            <input
              value={moveNote}
              onChange={(e) => setMoveNote(e.target.value)}
              maxLength={300}
              placeholder="anything that explains this movement later"
              className={inputCls}
            />
          </label>

          <button
            type="button"
            disabled={!canRecord}
            onClick={() => void recordMovement()}
            className={`${btnCls} mt-3`}
          >
            {fundBusy ? 'Recording…' : direction === 'collected' ? 'Record collection' : 'Record payout'}
          </button>
        </div>
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
                      onClick={() => void reopen(c.period_start, c.id)}
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
