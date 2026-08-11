// The dashboard's period control. ONE control, above everything it scopes —
// never a filter per card, or two cards end up answering about two different
// months and the page quietly contradicts itself.
//
// Pure on purpose: it takes today as an argument rather than reading the
// clock, so the resolution is testable and the server owns the IST call.
//
// A period is BOTH a date range and the list of month-starts it covers.
// Event tables are filtered by the range; the monthly views (section_costs,
// section_food_cost, pnl_monthly) are keyed by month and are read per month
// and summed. The two must never disagree, which is why one function
// produces both.

export type PeriodKey = 'this-month' | 'last-month' | 'last-3-months'

export type Period = {
  key: PeriodKey
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

export const PERIOD_KEYS: PeriodKey[] = ['this-month', 'last-month', 'last-3-months']

const PERIOD_LABELS: Record<PeriodKey, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3-months': 'Last 3 months',
}

export const isPeriodKey = (v: unknown): v is PeriodKey =>
  typeof v === 'string' && (PERIOD_KEYS as string[]).includes(v)

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** First day of the month `back` months before the month containing `date`. */
function monthStart(date: string, back = 0): string {
  const d = utc(date)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)))
}

/** Last day of the month containing `date`. */
function monthEnd(date: string): string {
  const d = utc(date)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
}

export function resolvePeriod(key: PeriodKey, today: string): Period {
  const label = PERIOD_LABELS[key]
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
  const from = monthStart(today, 0)
  return { key, label, from, to: today, months: [from], reportMonth: from }
}

export const monthLabel = (monthStart: string) =>
  utc(monthStart).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
