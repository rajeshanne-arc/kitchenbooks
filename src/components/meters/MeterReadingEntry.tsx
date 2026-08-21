'use client'

// THE READING IS TAKEN AT THE DAY CLOSE — and it is a SEPARATE SAVE.
//
// Utilities do not belong to Sales. What puts this form here is that somebody
// is already standing at this screen at a fixed time every night, and that is
// the whole of why a reading actually happens. Same principle as the cash
// voucher: whoever is physically there records it.
//
// IT MUST NEVER HOLD UP THE CASH CLOSE. The close has a hard chain — date D
// refuses to save while D-1 has no close — and a shortage belongs to the day
// it happened. So this is its own card with its own save button, above the
// close and outside its form. A forgotten meter never stands between a
// cashier and going home.
//
// ONE QUESTION AT A TIME still rules inside it: pick the meter, type what the
// dial shows. There is no rate field and there never will be — the reader
// does not price electricity.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MeterRow } from '@/lib/types'
import { saveMeterReading, type SaveReadingResult } from '@/server/meters-actions'
import SaveAck, { type Missing } from '@/components/SaveAck'
import Honesty from '@/components/Honesty'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { btnCls, cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'

type Ack = Extract<SaveReadingResult, { ok: true }>

const num = (s: string): string => {
  const t = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
  return t === '' || t === '-' ? '0' : t
}

export default function MeterReadingEntry({
  meters,
  unread,
  date,
}: {
  /** active meters this restaurant may read — already filtered by the mode */
  meters: MeterRow[]
  /** those with no reading yet for this business day */
  unread: MeterRow[]
  /** the BUSINESS day, resolved server-side. Never a browser clock. */
  date: string
}) {
  const router = useRouter()
  // THE PICKER STARTS EMPTY when there is a choice to make. A question that
  // answers itself is not a question — the issues.session lesson. With one
  // meter there is no choice, so preselecting it is not an assumption.
  const [meterId, setMeterId] = useState(meters.length === 1 ? meters[0].id : '')
  const [reading, setReading] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState<Ack | null>(null)

  if (meters.length === 0) return null

  const chosen = meters.find((m) => m.id === meterId) ?? null

  async function save() {
    if (busy || meterId === '' || reading.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const res = await saveMeterReading({ meterId, date, reading, note })
      if (!res.ok) {
        setError(res.error)
        setAck(null)
        return
      }
      setAck(res)
      // WHAT CARRIES: nothing but the date, which the card owns anyway. The
      // meter clears because filing the same meter twice for one night is a
      // CORRECTION, not the next entry — the closing form's argument exactly.
      setMeterId(meters.length === 1 ? meters[0].id : '')
      setReading('')
      setNote('')
      router.refresh()
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Meter reading</h2>
        <span className="font-mono text-[11px] text-stone-400">{fmtDate(date)}</span>
      </div>

      {ack !== null && (
        <div className="mt-3">
          <SaveAck
            headline={ackHeadline(ack)}
            sub={`${ack.meter} · ${fmtDate(date)}${ack.corrected ? ' · this filing supersedes the earlier one for tonight' : ''}`}
            missing={ackMissing(ack)}
            onDismiss={() => setAck(null)}
          />
        </div>
      )}

      <p className="mt-1.5 text-sm text-stone-600">
        Read the dial and type what it shows — not the difference. The app works the rest out.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabelCls}>Meter</span>
          <select
            value={meterId}
            onChange={(e) => setMeterId(e.target.value)}
            className={selectCls}
            disabled={busy}
          >
            {meters.length > 1 && <option value="">Pick the meter…</option>}
            {meters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.unit})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabelCls}>
            What the dial shows{chosen === null ? '' : ` — in ${chosen.unit}`}
          </span>
          <input
            inputMode="decimal"
            value={reading}
            onChange={(e) => setReading(e.target.value)}
            placeholder="45231.5"
            className={inputCls}
            disabled={busy}
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className={fieldLabelCls}>Note — optional</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="new meter fitted, dial reset…"
          className={inputCls}
          disabled={busy}
        />
      </label>

      {error !== null && (
        <p role="alert" className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || meterId === '' || reading.trim() === ''}
        className={`${btnCls} mt-3`}
      >
        {busy ? 'Saving…' : 'File the reading'}
      </button>

      {/* Silent when every meter has been read — a permanent "0 outstanding"
          is a thing people learn to dismiss. */}
      {unread.length > 0 && ack === null && (
        <div className="mt-3">
          <Honesty
            verdict="not read tonight"
            meter={{ filled: meters.length - unread.length, total: meters.length, unit: 'meters read' }}
          >
            {unread.map((m) => m.name).join(', ')} {unread.length === 1 ? 'has' : 'have'} no reading
            for {fmtDate(date)}. A night missed is not lost — the next reading simply covers two
            days, and it is stated that way rather than halved.
          </Honesty>
        </div>
      )}

      <p className="mt-3 text-xs text-stone-500">
        This saves on its own and never holds up the cash close.
      </p>
    </section>
  )
}

/** RULE 1 of the acknowledgement: say the numbers, never "Saved". */
function ackHeadline(a: Ack): string {
  const dial = `${num(a.reading)} ${a.unit}`
  if (a.wentBackwards) return `${dial} — below the previous reading`
  if (a.units === null) return `${dial} — the baseline for ${a.meter}`
  const used = `${num(a.units)} ${a.unit}`
  const span = a.daysSpanned === 1 ? 'since last night' : `over ${a.daysSpanned} days`
  return a.estimatedCost === null
    ? `${dial} · ${used} used ${span}`
    : `${dial} · ${used} used ${span} — about ${formatMoneyString(a.estimatedCost)}`
}

/** RULE 2: name what is still missing, at the one moment it can be fixed. */
function ackMissing(a: Ack): Missing[] {
  const out: Missing[] = []

  if (a.wentBackwards) {
    out.push({
      level: 'alarm',
      verdict: 'the meter went backwards',
      text: (
        <>
          {a.previousDate === null ? 'The previous reading' : `The reading on ${fmtDate(a.previousDate)}`} was{' '}
          {num(a.previousReading ?? '0')} {a.unit} and this one is lower. That is real when a dial
          rolls over from all-nines to zero or when a meter is replaced — and it is far more often a
          typo. No consumption and no cost is stated for tonight until it is settled. File the right
          figure for this date; the latest filing wins and both stay on the record.
        </>
      ),
    })
  } else if (a.units === null) {
    out.push({
      verdict: 'nothing to compare yet',
      text: (
        <>
          This is the first reading for {a.meter}, so it measures nothing — it is the line the next
          one is measured from. Tomorrow night&apos;s reading is the first that says anything.
        </>
      ),
    })
  } else if (a.daysSpanned !== null && a.daysSpanned > 1) {
    out.push({
      verdict: `covers ${a.daysSpanned} days`,
      text: (
        <>
          The last reading was on {a.previousDate === null ? 'an earlier day' : fmtDate(a.previousDate)},
          so this figure is {a.daysSpanned} days&apos; consumption and is left whole. It is{' '}
          <b>not</b> divided across those days — splitting it would invent figures for days nobody
          measured.
        </>
      ),
    })
  }

  if (a.estimatedCost !== null && !a.wentBackwards) {
    out.push({
      verdict: 'the cost is an estimate',
      text: (
        <>
          {formatMoneyString(a.estimatedCost)} is units × the rate on the meter. Electricity is
          slabbed, so the real unit cost depends on the whole month and is not known until the bill
          arrives. Reconcile it then.
        </>
      ),
    })
  } else if (a.estimatedCost === null && a.units !== null && !a.wentBackwards) {
    out.push({
      verdict: 'no rate on this meter',
      text: (
        <>
          {a.meter} carries no rate per unit, so the units are recorded and no rupee figure is. An
          owner or the accountant sets the rate on the Meters screen — an estimate of ₹0.00 would
          read as free electricity, so none is shown.
        </>
      ),
    })
  }

  return out
}
