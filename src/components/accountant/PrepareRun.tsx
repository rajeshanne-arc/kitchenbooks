'use client'

// THE DRAFT — computed, shown, edited, and not stored.
//
// Everything in this table is worked out from attendance the moment the page
// loads. Pressing Prepare writes it down permanently: payroll_lines has no
// UPDATE grant on any amount, so from that moment the run says what it says.
// A mistake is fixed by cancelling the run and preparing another, and both
// stay on the record. That sentence sits above the button, not in a footnote.
//
// The period is OFFERED (last month) and never assumed, and changing it
// re-reads the draft from the SERVER rather than adjusting anything here: the
// pay law lives in the database and there is only one of it. The component is
// keyed on the loaded period by the page, so a fresh draft arrives as a fresh
// form — a soft navigation that leaves old state mounted is the bug that made
// indent prefill "land nowhere".

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { PayrollDraftLine, PayrollRunRow } from '@/lib/types'
import { preparePayrollRun } from '@/server/payroll-actions'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty, { HonestyPill } from '@/components/Honesty'
import { toast } from '@/components/Toasts'
import {
  btnCls,
  cardCls,
  fieldLabelCls,
  dataTableCls,
  inputCls,
  numCls,
  sectionHeadCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

type Cells = { overtime: string; advance: string; other: string; withholding: string }

const BLANK: Cells = { overtime: '', advance: '', other: '', withholding: '' }

/** The server's own rule, copied so the screen refuses exactly what the
 *  action would and never refuses something it would have accepted. */
const MONEY_RE = /^\d{1,11}(\.\d{1,2})?$/

const clean = (s: string) => s.replace(/[^\d.]/g, '')

const valid = (s: string) => s.trim() === '' || MONEY_RE.test(s.trim())

/** empty means nought — but the action is sent a real '0', never a blank */
const amount = (s: string) => (s.trim() === '' ? '0' : s.trim())

const paise = (s: string) => (s.trim() === '' ? 0 : decimalStringToPaise(s.trim()))

export default function PrepareRun({
  draft,
  loadedFrom,
  loadedTo,
  clash,
}: {
  draft: PayrollDraftLine[]
  loadedFrom: string
  loadedTo: string
  /** a live run already covering this period — the server refuses a second */
  clash: PayrollRunRow | null
}) {
  const router = useRouter()
  const [from, setFrom] = useState(loadedFrom)
  const [to, setTo] = useState(loadedTo)
  const [note, setNote] = useState('')
  const [cells, setCells] = useState<Record<string, Cells>>(() =>
    Object.fromEntries(
      draft.map((d) => [
        d.staff_id,
        {
          ...BLANK,
          // offered, and editable down: a person may not be able to repay the
          // whole advance out of one month
          advance: decimalStringToPaise(d.advance_outstanding) > 0 ? d.advance_outstanding : '',
        },
      ]),
    ),
  )
  const [busy, setBusy] = useState(false)
  const [loading, startLoading] = useTransition()

  const cellsOf = (id: string) => cells[id] ?? BLANK
  const set = (id: string, part: Partial<Cells>) =>
    setCells((c) => ({ ...c, [id]: { ...cellsOf(id), ...part } }))

  const net = (d: PayrollDraftLine, c: Cells) =>
    decimalStringToPaise(d.earned) +
    paise(c.overtime) -
    paise(c.advance) -
    paise(c.other) -
    paise(c.withholding)

  const reversed = loadedTo < loadedFrom
  const stale = from !== loadedFrom || to !== loadedTo
  const allValid = draft.every((d) => {
    const c = cellsOf(d.staff_id)
    return valid(c.overtime) && valid(c.advance) && valid(c.other) && valid(c.withholding)
  })

  const unsalaried = draft.filter((d) => d.unsalaried).length
  const unmarked = draft.filter((d) => !d.unsalaried && decimalStringToPaise(d.days_paid) === 0).length
  const belowZero = allValid ? draft.filter((d) => net(d, cellsOf(d.staff_id)) < 0).length : 0

  const total = (pick: (d: PayrollDraftLine, c: Cells) => number) =>
    draft.reduce((a, d) => a + pick(d, cellsOf(d.staff_id)), 0)

  const canSave = !busy && !stale && !reversed && clash === null && draft.length > 0 && allValid

  function load() {
    if (from === '' || to === '') return
    startLoading(() => router.replace(`/accounts/payroll/runs?from=${from}&to=${to}`))
  }

  async function prepare() {
    if (!canSave) return
    setBusy(true)
    try {
      const res = await preparePayrollRun({
        periodStart: loadedFrom,
        periodEnd: loadedTo,
        note: note.trim(),
        lines: draft.map((d) => {
          const c = cellsOf(d.staff_id)
          return {
            staffId: d.staff_id,
            daysInPeriod: d.days_in_period,
            daysPaid: d.days_paid,
            baseSalary: d.base_salary,
            earned: d.earned,
            overtime: amount(c.overtime),
            advanceRecovered: amount(c.advance),
            otherDeduction: amount(c.other),
            withholding: amount(c.withholding),
            note: '',
          }
        }),
      })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      toast('Run prepared — the figures are frozen', 'ok')
      router.push(`/accounts/payroll/runs/${res.run.id}`)
    } catch {
      toast('Could not reach the server — nothing was prepared.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Which month</h2>
        <p className="mt-1.5 text-sm text-stone-700">
          Last month is offered because it is the one almost always being run. It is an offer — pick
          any period and the draft is worked out again from the attendance inside it.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>
        {stale && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={loading || from === '' || to === ''}
              onClick={load}
              className={btnCls}
            >
              {loading ? 'Reading attendance…' : 'Work out this period'}
            </button>
            <p className="text-xs text-stone-500">
              The table below is still {fmtDate(loadedFrom)} — {fmtDate(loadedTo)}.
            </p>
          </div>
        )}
      </section>

      {reversed ? (
        <Honesty level="alarm" verdict="period runs backwards">
          {fmtDate(loadedTo)} is before {fmtDate(loadedFrom)}, so there is no period to count days
          in. Pick an end date on or after the start and work it out again.
        </Honesty>
      ) : (
        <section className={cardCls}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>
              Draft — {fmtDate(loadedFrom)} to {fmtDate(loadedTo)}
            </h2>
            <span className="font-mono text-[10px] text-stone-400">attendance_current</span>
          </div>

          {draft.length === 0 ? (
            <p className="mt-1.5 text-sm text-stone-700">
              Nobody to pay for this period. Contract staff are left out on purpose — they are billed
              by their vendor and their money is in contract bills — so an empty draft means every
              active person is on contract, or that nobody is on the roster yet. Either way it is a
              real answer, not a failure to load.
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-stone-700">
                Days and earnings are the pay law applied to what the manager marked: present 1,
                half 0.5, off 1 — off is paid — leave and absent 0, over the real days of the
                period. Adjust the money with overtime and deductions; the days are what happened.
              </p>

              <div className="mt-3 space-y-2">
                {clash !== null && (
                  <Honesty
                    level="alarm"
                    verdict="already run"
                    action={{
                      href: `/accounts/payroll/runs/${clash.id}`,
                      label: 'Open the run that covers it',
                    }}
                  >
                    {fmtDate(clash.period_start)} — {fmtDate(clash.period_end)} is already covered by
                    a run marked {clash.status}, so a second one over the same days is refused: it
                    would pay the same month twice. Cancel that run if its figures are wrong, then
                    prepare this one.
                  </Honesty>
                )}
                {unsalaried > 0 && (
                  <Honesty
                    verdict="no salary on record"
                    meter={{ filled: draft.length - unsalaried, total: draft.length, unit: 'people with a salary' }}
                    action={{ href: '/accounts/payroll/people', label: 'Set what they are paid' }}
                  >
                    {unsalaried} of these {draft.length} people worked and nobody has said what they
                    are paid. They earn 0 here, and that is a question rather than a wage — preparing
                    now freezes the zero, and fixing it afterwards means cancelling this run and
                    preparing another.
                  </Honesty>
                )}
                {unmarked > 0 && (
                  <Honesty verdict="no attendance">
                    {unmarked} salaried {unmarked === 1 ? 'person has' : 'people have'} not a single
                    day marked in this period, so {unmarked === 1 ? 'that line earns' : 'those lines earn'}{' '}
                    0. That is either a month they did not work or a month nobody marked — the app
                    cannot tell those apart and will not guess.
                  </Honesty>
                )}
                {belowZero > 0 && (
                  <Honesty level="alarm" verdict="below zero">
                    {belowZero} {belowZero === 1 ? 'line comes' : 'lines come'} out negative — more is
                    being recovered and withheld than was earned. Recover less of the advance this
                    month rather than paying somebody a negative wage.
                  </Honesty>
                )}
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className={dataTableCls}>
                  <thead>
                    <tr>
                      <th className={thCls}>Code</th>
                      <th className={thCls}>Name</th>
                      <th className={thNumCls}>Days</th>
                      <th className={thNumCls}>Base</th>
                      <th className={thNumCls}>Earned</th>
                      <th className={thNumCls}>Overtime</th>
                      <th className={thNumCls}>Advance</th>
                      <th className={thNumCls}>Other</th>
                      <th className={thNumCls}>Withheld</th>
                      <th className={thNumCls}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.map((d) => {
                      const c = cellsOf(d.staff_id)
                      const rowNet = net(d, c)
                      const cell = (value: string, label: string, put: (v: string) => void) => (
                        <td className="border-b border-rule-soft px-1 py-1.5">
                          <input
                            inputMode="decimal"
                            placeholder="0"
                            aria-label={`${label} for ${d.staff_name}`}
                            value={value}
                            onChange={(e) => put(clean(e.target.value))}
                            className={`${numCls} w-24 text-right font-mono tabular-nums ${
                              valid(value) ? '' : 'border-red-400'
                            }`}
                          />
                        </td>
                      )
                      return (
                        <tr key={d.staff_id} className={trCls}>
                          <td className={tdCodeCls}>{d.staff_code}</td>
                          <td className={`${tdCls} whitespace-nowrap`}>
                            <span className="flex items-center gap-2">
                              {d.staff_name}
                              {d.unsalaried && <HonestyPill>no salary</HonestyPill>}
                            </span>
                          </td>
                          <td className={`${tdNumCls} whitespace-nowrap text-stone-500`}>
                            {d.days_paid} / {d.days_in_period}
                          </td>
                          <td className={`${tdNumCls} text-stone-500`}>
                            {d.unsalaried ? '—' : formatMoneyString(d.base_salary)}
                          </td>
                          <td className={tdNumCls}>{formatMoneyString(d.earned)}</td>
                          {cell(c.overtime, 'Overtime', (v) => set(d.staff_id, { overtime: v }))}
                          {cell(c.advance, 'Advance recovered', (v) =>
                            set(d.staff_id, { advance: v }),
                          )}
                          {cell(c.other, 'Other deduction', (v) => set(d.staff_id, { other: v }))}
                          {cell(c.withholding, 'Withholding', (v) =>
                            set(d.staff_id, { withholding: v }),
                          )}
                          <td
                            className={`${tdNumCls} font-semibold ${
                              rowNet < 0 ? 'text-red-700' : 'text-stone-900'
                            }`}
                          >
                            {Number.isFinite(rowNet) ? formatPaise(rowNet) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className={`${tdCls} font-medium text-stone-500`} colSpan={4}>
                        {draft.length} {draft.length === 1 ? 'person' : 'people'}
                      </td>
                      <td className={`${tdNumCls} font-semibold`}>
                        {formatPaise(total((d) => decimalStringToPaise(d.earned)))}
                      </td>
                      <td className={`${tdNumCls} font-semibold`}>
                        {formatPaise(total((_d, c) => paise(c.overtime)))}
                      </td>
                      <td className={`${tdNumCls} font-semibold`}>
                        {formatPaise(total((_d, c) => paise(c.advance)))}
                      </td>
                      <td className={`${tdNumCls} font-semibold`}>
                        {formatPaise(total((_d, c) => paise(c.other)))}
                      </td>
                      <td className={`${tdNumCls} font-semibold`}>
                        {formatPaise(total((_d, c) => paise(c.withholding)))}
                      </td>
                      <td className={`${tdNumCls} font-semibold`}>
                        {formatPaise(total(net))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="mt-2 text-xs text-stone-500">
                Earned is the pay law&apos;s own figure and is not typed over — an adjustment belongs
                in overtime or in other deduction, where it is visible as an adjustment. Advance is
                offered at what is still owed and can be brought down. Net is worked out here as you
                type, and worked out again on the server from the frozen parts when you press
                prepare; that second one is the figure of record.
              </p>
              <p className="mt-1.5 text-xs text-stone-500">
                <span className="font-medium text-stone-600">Withheld</span> — PF, ESI, TDS,
                anything else: record what was withheld. The app does not work out a rate. Statutory
                rates change by notification, differ by state and differ entirely outside this
                country, and this app files nothing with anybody.
              </p>

              <label className="mt-3 block">
                <span className={fieldLabelCls}>Note on the run (optional)</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  placeholder="anything the owner should know before approving"
                  className={inputCls}
                />
              </label>

              <p className="mt-3 text-sm text-stone-700">
                Pressing prepare freezes every figure above: none of them can be edited afterwards,
                by anyone. A mistake is fixed by cancelling the run and preparing another, and both
                stay on the record.
              </p>

              <button
                type="button"
                disabled={!canSave}
                onClick={() => void prepare()}
                className={`${btnCls} mt-3`}
              >
                {busy
                  ? 'Preparing…'
                  : stale
                    ? 'Work out the picked period first'
                    : clash !== null
                      ? 'This period already has a run'
                      : allValid
                        ? `Prepare this run (${draft.length})`
                        : 'Fix the amounts in red'}
              </button>
              <p className="mt-2 text-xs text-stone-400">
                Prepared is not approved and approved is not paid. An owner approves; only then can
                the run be marked paid.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  )
}
