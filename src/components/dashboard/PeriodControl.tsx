'use client'

// ONE DATE CONTROL, not a strip of chips and a pair of bare inputs.
//
// The shape is the one Rajesh already uses every day in Petpooja: a single
// trigger showing what is currently selected, and a popover holding the
// presets down the left rail beside the calendar itself. The two halves are
// ONE CONTROL — clicking a preset highlights its range on the calendar rather
// than closing the popover, so a person can see what "Last 7 days" actually
// means and then nudge an edge of it.
//
// APPLY IS WHAT COMMITS. Nothing navigates on the first click of a range: a
// half-picked range is not a period, and firing a query on it would show a
// day's figures under a heading the person is halfway through changing.
//
// THE URL STILL CARRIES IT. A preset commits as ?period=last-7-days — RELATIVE,
// so a link shared tonight still means the last seven days tomorrow — and a
// hand-picked range commits as ?period=2026-08-01..2026-08-17, absolute,
// because that is what was asked for. Both survive a bookmark and a paste.
//
// MOBILE IS ONE MONTH. 380px cannot hold two grids, and the store, the chef
// and the cashier are all on phones; the second grid is hidden below `sm` and
// the paging arrows carry the whole job there.

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  PERIOD_KEYS,
  PERIOD_LABELS,
  PERIOD_SEP,
  isDate,
  resolvePeriod,
  type Period,
  type PeriodKey,
} from '@/lib/period'
import { fmtRange } from '@/lib/format'

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const iso = (d: Date) => d.toISOString().slice(0, 10)
const utc = (s: string) => new Date(`${s}T00:00:00Z`)
const addMonths = (monthStart: string, n: number) => {
  const d = utc(monthStart)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)))
}
const monthOf = (s: string) => `${s.slice(0, 7)}-01`
const monthTitle = (m: string) =>
  utc(m).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Every cell of a month grid: leading blanks, then the days. */
function grid(month: string): (string | null)[] {
  const first = utc(month)
  const lead = first.getUTCDay()
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const cells: (string | null)[] = Array<string | null>(lead).fill(null)
  for (let i = 1; i <= days; i++) {
    cells.push(iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), i))))
  }
  return cells
}

/** One month grid. A real component, not one built inside render — React
 *  remounts a component identity that changes every render, which would blow
 *  away focus and make the keyboard useless on the calendar. */
function Month({
  month,
  today,
  dayCls,
  onPick,
}: {
  month: string
  today: string
  dayCls: (d: string) => string
  onPick: (d: string) => void
}) {
  return (
    <div className="w-[15.5rem]">
      <div className="mb-1 text-center text-[13px] font-semibold text-stone-800">{monthTitle(month)}</div>
      <div className="grid grid-cols-7 text-center">
        {DOW.map((d, i) => (
          <span key={i} className="py-1 text-[10px] font-medium uppercase text-stone-400">
            {d}
          </span>
        ))}
        {grid(month).map((d, i) =>
          d === null ? (
            <span key={`b${i}`} />
          ) : (
            <button
              key={d}
              type="button"
              disabled={d > today}
              onClick={() => onPick(d)}
              className={`h-8 rounded-md text-[13px] tabular-nums ${dayCls(d)}`}
            >
              {Number(d.slice(8))}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

/** The compact form for the trigger: "19 Aug 2026", or "1–17 Aug 2026". */
const compact = (from: string, to: string) => fmtRange(from, to)

export default function PeriodControl({
  period,
  today,
  basePath = '/owner',
  error = null,
}: {
  /** the RESOLVED period, so the control states the range it actually covers
   *  rather than only the name of the button that was pressed */
  period: Period
  /** the BUSINESS day, passed from the server rather than read from a hook —
   *  useBusinessDay() throws outside a provider, and this control mounts on
   *  twelve pages across five groups. A clock read here would say "tomorrow"
   *  at 00:30, which is the exact bug the business day exists to prevent. */
  today: string
  basePath?: string
  /** a refusal to show — a reversed or impossible range is a mistake somebody
   *  can fix, and swallowing it would leave them reading a period they never
   *  asked for and never noticed they did not ask for */
  error?: string | null
}) {
  const router = useRouter()
  const params = useSearchParams()
  const box = useRef<HTMLDivElement>(null)

  const activeKey: PeriodKey | null = typeof period.key === 'string' ? period.key : null
  const [open, setOpen] = useState(false)
  // the DRAFT: what the popover is showing, committed only by Apply
  const [draftKey, setDraftKey] = useState<PeriodKey | null>(activeKey)
  const [from, setFrom] = useState(period.from)
  const [to, setTo] = useState<string | null>(period.to)
  const [view, setView] = useState(monthOf(period.to))

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const href = (value: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (value === null) next.delete('period')
    else next.set('period', value)
    const q = next.toString()
    return q === '' ? basePath : `${basePath}?${q}`
  }

  /** Tapping a preset SHOWS it — it does not commit and does not close. */
  function pickPreset(k: PeriodKey) {
    const p = resolvePeriod(k, today)
    setDraftKey(k)
    setFrom(p.from)
    setTo(p.to)
    setView(monthOf(p.to))
  }

  /** First tap starts a range, second tap ends it. Nothing is committed. */
  function pickDay(d: string) {
    if (d > today) return
    setDraftKey(null)
    if (to === null) {
      if (d < from) setFrom(d)
      else setTo(d)
      return
    }
    setFrom(d)
    setTo(null)
  }

  const ready = isDate(from) && to !== null && isDate(to) && to >= from
  function apply() {
    if (!ready || to === null) return
    setOpen(false)
    // A PRESET COMMITS AS ITSELF, not as the dates it happens to resolve to
    // today — otherwise "Last 7 days" would freeze the moment it was shared.
    if (draftKey !== null) router.push(href(draftKey === 'this-month' ? null : draftKey))
    else router.push(href(`${from}${PERIOD_SEP}${to}`))
  }

  const inDraft = (d: string) => (to === null ? d === from : d >= from && d <= to)
  const dayCls = (d: string) => {
    const edge = d === from || d === to
    const disabled = d > today
    if (disabled) return 'text-stone-300 cursor-not-allowed'
    if (edge) return 'bg-emerald-700 text-white font-semibold'
    if (inDraft(d)) return 'bg-emerald-50 text-emerald-900'
    return 'text-stone-700 hover:bg-stone-100'
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => {
          // Reseed from what is actually LIVE, in the event rather than an
          // effect. A control that reopened onto an abandoned draft would show
          // a selection the page is not reporting.
          if (!open) {
            setDraftKey(activeKey)
            setFrom(period.from)
            setTo(period.to)
            setView(monthOf(period.to))
          }
          setOpen((v) => !v)
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex min-h-[40px] items-center gap-2 rounded-xl border border-rule bg-cell px-3 py-2 text-sm font-medium text-stone-800 hover:border-emerald-400"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-stone-500" fill="none" aria-hidden>
          <rect x="3" y="4.5" width="14" height="12.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 8.5h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="tabular-nums">{compact(period.from, period.to)}</span>
        {activeKey !== null && (
          <span className="text-xs font-normal text-stone-500">· {PERIOD_LABELS[activeKey]}</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a period"
          className="absolute right-0 z-30 mt-2 w-[min(92vw,34rem)] rounded-2xl border border-rule bg-cell p-3 shadow-xl sm:w-auto"
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            {/* the presets are part of this control, not a separate strip */}
            <div className="flex shrink-0 flex-row flex-wrap gap-1 sm:w-[8.5rem] sm:flex-col">
              {PERIOD_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => pickPreset(k)}
                  aria-pressed={draftKey === k}
                  className={`rounded-lg px-2.5 py-2 text-left text-[13px] font-medium ${
                    draftKey === k
                      ? 'bg-emerald-700 text-white'
                      : 'text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  {PERIOD_LABELS[k]}
                </button>
              ))}
            </div>

            <div className="sm:border-l sm:border-rule sm:pl-3">
              <div className="mb-1 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setView((m) => addMonths(m, -1))}
                  aria-label="Previous month"
                  className="rounded-md px-2 py-1 text-stone-500 hover:bg-stone-100"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setView((m) => addMonths(m, 1))}
                  aria-label="Next month"
                  disabled={addMonths(view, 1) > monthOf(today)}
                  className="rounded-md px-2 py-1 text-stone-500 hover:bg-stone-100 disabled:text-stone-300"
                >
                  ›
                </button>
              </div>
              <div className="flex gap-4">
                <Month month={addMonths(view, -1)} today={today} dayCls={dayCls} onPick={pickDay} />
                {/* TWO MONTHS on a desktop, ONE on a phone. 380px cannot hold
                    two grids, and the paging arrows do the whole job there. */}
                <div className="hidden sm:block">
                  <Month month={view} today={today} dayCls={dayCls} onPick={pickDay} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3">
            {/* THE RESOLVED RANGE IN WORDS, always, so nobody commits on a
                label they have misread. */}
            <span className="text-[13px] text-stone-600">
              {to === null ? (
                <span className="text-stone-500">Pick the end of the range</span>
              ) : (
                <>
                  {compact(from, to)}
                  {draftKey !== null && (
                    <span className="text-stone-400"> · {PERIOD_LABELS[draftKey]}</span>
                  )}
                </>
              )}
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-[40px] rounded-xl px-3 text-sm font-medium text-stone-600 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={!ready}
                className="min-h-[40px] rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                Apply
              </button>
            </span>
          </div>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
