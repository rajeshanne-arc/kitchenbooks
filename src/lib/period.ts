// The dashboard's period control. ONE control, above everything it scopes —
// never a filter per card, or two cards end up answering about two different
// months and the page quietly contradicts itself.
//
// Pure on purpose: it takes today as an argument rather than reading the
// clock, so the resolution is testable and the server owns the IST call.
//
import { fmtRange } from '@/lib/format'

// A period is BOTH a date range and the list of month-starts it covers.
// Event tables are filtered by the range; the monthly views (section_costs,
// section_food_cost, pnl_monthly) are keyed by month and are read per month
// and summed. The two must never disagree, which is why one function
// produces both.

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'last-7-days'
  | 'this-month'
  | 'last-month'
  | 'last-3-months'

/**
 * An arbitrary range, and a SIBLING of PeriodKey rather than a widening of it.
 *
 * Widening the union would break the two `Record<PeriodKey, string>` maps —
 * PERIOD_LABELS below and LABELS in PeriodControl — neither of which can be
 * keyed by an open type, and it would force isPeriodKey to admit more than its
 * three-string whitelist. As a sibling, every existing export is untouched.
 */
export type CustomPeriod = { kind: 'custom'; from: string; to: string }

/** What a page may be handed: one of the three presets, or a range. */
export type PeriodParam = PeriodKey | CustomPeriod

/** The separator in ?period=2026-08-01..2026-08-17.
 *
 *  ONE PARAMETER, not from= and to=. Three link builders in the app carry the
 *  period forward as a single string, eleven pages type searchParams with a
 *  single optional `period`, and `from`/`to` are already taken for a different
 *  meaning on the payroll runs page. `.` is RFC 3986 unreserved, so nothing
 *  percent-encodes and there is no `&` for a chat client to mangle. */
export const PERIOD_SEP = '..'

/** A custom range may span at most this many calendar months.
 *
 *  REFUSED, NEVER TRUNCATED. `months` feeds `month = any($1::date[])` while
 *  from/to feed the event tables; truncating one and not the other would make
 *  the monthly cards sum a different set of months than the range covers,
 *  which is exactly the disagreement the header of this file forbids. Thirteen
 *  because getPnlMonthly already treats thirteen months as the horizon of the
 *  books. */
export const MAX_RANGE_MONTHS = 13

export type Period = {
  key: PeriodParam
  label: string
  /** inclusive first date, YYYY-MM-DD */
  from: string
  /** inclusive last date, YYYY-MM-DD */
  to: string
  /** every month-start the range touches, oldest first */
  months: string[]
  /** the single month the monthly-view cards report on — the LAST one, named
   *  on screen so a three-month period never implies a blended percentage */
  reportMonth: string
}

// Shortest first — a store manager asking about TODAY was the obvious gap and
// could not do it at all. ADDITIVE: the three month presets keep their exact
// resolutions, proved by a golden table captured before they had company.
export const PERIOD_KEYS: PeriodKey[] = [
  'today',
  'yesterday',
  'last-7-days',
  'this-month',
  'last-month',
  'last-3-months',
]

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'last-7-days': 'Last 7 days',
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3-months': 'Last 3 months',
}

export const isPeriodKey = (v: unknown): v is PeriodKey =>
  typeof v === 'string' && (PERIOD_KEYS as string[]).includes(v)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A real calendar date, and the ROUND TRIP is the whole point.
 *
 * A regex alone is not enough, measured: `utc('2026-02-31')` rolls SILENTLY to
 * 2026-03-03 — a wrong range that renders perfectly — while '2026-13-01',
 * '2026-8-1' and 'not-a-date' make `iso()` throw a RangeError, which on this
 * path would be a 500 on twelve pages. This predicate is the one already
 * proven on the payroll runs screen, moved here so there is one of it.
 */
export function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** First day of the month `back` months before the month containing `date`. */
function monthStart(date: string, back = 0): string {
  const d = utc(date)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)))
}

/** `n` days before `date`, as YYYY-MM-DD. Pure UTC arithmetic on a date string,
 *  so it cannot drift with a timezone — the ANCHOR carries the business day,
 *  and shifting it by whole days keeps it a business day. */
function daysBefore(date: string, n: number): string {
  const d = utc(date)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n)))
}

/** Last day of the month containing `date`. */
function monthEnd(date: string): string {
  const d = utc(date)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
}

/** Every month-start a range touches, oldest first. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  const end = monthStart(to)
  let cur = monthStart(from)
  // guarded by MAX_RANGE_MONTHS upstream; the bound here is belt and braces
  for (let i = 0; cur <= end && i <= MAX_RANGE_MONTHS; i++) {
    out.push(cur)
    const d = utc(cur)
    cur = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
  }
  return out
}

/**
 * WHICH EDGES OF A RANGE ARE PARTIAL MONTHS.
 *
 * The monthly views cannot be asked a half-month question: `section_costs` is a
 * join of whole-month aggregates and `section_food_cost` takes its opening from
 * the last closing before the month and its ending from the last closing inside
 * it. So a range starting on the 15th makes those cards report the WHOLE of
 * that month while the event-table cards beside them correctly start on the
 * 15th — two cards, one heading, two different questions.
 *
 * That is not new: `this-month` runs 1st→today and already reports the whole
 * month's food cost. What is new is a range whose START is not a 1st. Rather
 * than add a field to Period — which would make every consumer learn a second
 * shape — the misalignment is DERIVED from fields Period already has, and the
 * two pages that read monthly views say so in words. Never compute a figure to
 * fill the gap.
 */
export function partialEdges(p: Period): { head: boolean; tail: boolean } {
  return {
    head: p.from !== p.months[0],
    tail: p.to !== monthEnd(p.reportMonth),
  }
}

export function resolvePeriod(key: PeriodParam, today: string): Period {
  // FIRST, and deliberately. PERIOD_LABELS[key] below runs unconditionally
  // before any branch and would hand a range `undefined` as its label; and
  // `this-month` is reached by falling through rather than by an `if`, so a
  // custom branch placed beside the other two would return a THIS-MONTH range
  // wearing a custom key — the URL saying 15 July to 17 August while every
  // figure on the page is August, with nothing throwing and nothing looking
  // wrong.
  if (typeof key !== 'string') {
    // A range ending in the future is CLAMPED, not refused: both presets that
    // can run past today already clamp, and an owner pasting a month-end range
    // on the 17th means "up to now". A period never reports days that have not
    // happened.
    const to = key.to > today ? today : key.to
    const from = key.from
    const months = monthsBetween(from, to)
    return {
      key,
      // THE LABEL CARRIES THE DATES. Four pages print period.label as the only
      // thing naming their scope, with no dates beside it; a label reading
      // "Custom" would leave them unable to state what they cover.
      label: `${fmtRange(from, to)}`,
      from,
      to,
      months,
      reportMonth: months[months.length - 1],
    }
  }

  const label = PERIOD_LABELS[key]

  // THE DAY PRESETS. `today` is the BUSINESS day the caller handed in — at
  // 00:30 that is still yesterday's calendar date, which is the whole reason
  // every call site anchors on businessToday() rather than a clock.
  if (key === 'today') {
    return { key, label, from: today, to: today, months: [monthStart(today)], reportMonth: monthStart(today) }
  }
  if (key === 'yesterday') {
    const d = daysBefore(today, 1)
    return { key, label, from: d, to: d, months: [monthStart(d)], reportMonth: monthStart(d) }
  }
  if (key === 'last-7-days') {
    // seven days INCLUSIVE of today, so six back — "last 7 days" that returned
    // eight would be off by one every time somebody counted.
    const from = daysBefore(today, 6)
    return {
      key,
      label,
      from,
      to: today,
      months: monthsBetween(from, today),
      reportMonth: monthStart(today),
    }
  }

  if (key === 'last-month') {
    const from = monthStart(today, 1)
    return { key, label, from, to: monthEnd(from), months: [from], reportMonth: from }
  }
  if (key === 'last-3-months') {
    const months = [monthStart(today, 2), monthStart(today, 1), monthStart(today, 0)]
    // ends today, not at month end — a period cannot report days that
    // have not happened, and an empty tail would read as a collapse in sales.
    return { key, label, from: months[0], to: today, months, reportMonth: months[2] }
  }
  // `this-month`, stated rather than fallen into — so the next key added cannot
  // inherit it by accident, which is exactly how a custom range would have
  // silently reported August.
  const from = monthStart(today, 0)
  return { key, label, from, to: today, months: [from], reportMonth: from }
}

/**
 * The FRONT DOOR: read whatever arrived in ?period=, once.
 *
 * Twelve pages carried the identical ternary `isPeriodKey(v) ? v : 'this-month'`.
 * Turning twelve hand-written two-branch ternaries into twelve hand-written
 * three-branch ones is twelve chances to get preset/custom precedence wrong, so
 * there is one of these and they all call it.
 *
 * A REFUSAL IS NAMED, NOT SWALLOWED. A reversed range is a mistake somebody
 * made and can fix; falling back to this month without a word would leave them
 * looking at figures for a period they did not ask for and did not notice they
 * did not ask for. The caller renders `error` beside the control.
 */
export function readPeriodParam(
  v: unknown,
  /** the BUSINESS day, so a range ending "today" means the day the restaurant
   *  is working, not whatever the browser's calendar says at 00:30 */
  today: string,
): { param: PeriodParam; error: string | null } {
  if (v === undefined || v === null || v === '') return { param: 'this-month', error: null }
  if (isPeriodKey(v)) return { param: v, error: null }
  if (typeof v !== 'string' || !v.includes(PERIOD_SEP)) {
    return { param: 'this-month', error: null }
  }
  const [from, to, ...rest] = v.split(PERIOD_SEP)
  if (rest.length > 0 || !isDate(from) || !isDate(to)) {
    return { param: 'this-month', error: 'That date range is not readable — showing this month instead.' }
  }
  // REFUSED BY NAME, never silently swapped: swapping would answer a question
  // nobody asked, and the person would never learn they had typed it backwards.
  if (to < from) {
    return {
      param: 'this-month',
      error: `The start (${from}) is later than the end (${to}) — swap them. Showing this month meanwhile.`,
    }
  }
  if (from > today) {
    return {
      param: 'this-month',
      error: `That range starts on ${from}, which has not happened yet. Showing this month instead.`,
    }
  }
  // MEASURED AGAINST THE CLAMPED END. A range ending in the future is fine —
  // resolvePeriod clamps it to today — so counting its months against the raw
  // end would refuse "1 Aug to the end of time" as too long when it is really
  // nineteen days.
  const effectiveTo = to > today ? today : to
  if (monthsBetween(from, effectiveTo).length > MAX_RANGE_MONTHS) {
    return {
      param: 'this-month',
      error: `A range can cover at most ${MAX_RANGE_MONTHS} months. Showing this month instead.`,
    }
  }
  return { param: { kind: 'custom', from, to }, error: null }
}

/** The ?period= value for a range — the inverse of readPeriodParam. */
export const periodParamValue = (p: PeriodParam): string =>
  typeof p === 'string' ? p : `${p.from}${PERIOD_SEP}${p.to}`

export const monthLabel = (monthStart: string) =>
  utc(monthStart).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
