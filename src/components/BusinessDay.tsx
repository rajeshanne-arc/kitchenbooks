'use client'

// THE BUSINESS DAY, on the client.
//
// A form cannot ask Postgres what day it is, and it must not work it out from
// the browser's clock — that is the bug. At 00:47 the phone says the 12th and
// the restaurant is still working the 11th. So the server resolves the day
// once per request in the group layout and hands it down through here.
//
// One provider per GROUP layout rather than one at the root: the root also
// renders /login, where there is no session, and a date nobody is entering is
// a database round trip nobody needs.
import { createContext, useContext } from 'react'
import { fmtDate } from '@/lib/format'

export type BusinessDay = {
  /** What every date field defaults to. */
  businessDate: string
  /** The wall clock, for comparison only — never a default. */
  calendarDate: string
  /** e.g. '05:00' — the hour the restaurant's day rolls over. */
  dayStart: string
}

const Ctx = createContext<BusinessDay | null>(null)

export function BusinessDayProvider({
  value,
  children,
}: {
  value: BusinessDay
  children: React.ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * The date a form should default to.
 *
 * THROWS outside a provider rather than falling back to the browser's date.
 * A silent fallback here reproduces the exact bug this exists to fix, and it
 * would only show up for two hours a night — the hardest kind of wrong to
 * notice. A missing provider is a build-time mistake and should read like one.
 */
export function useBusinessDay(): BusinessDay {
  const v = useContext(Ctx)
  if (v === null) {
    throw new Error(
      'useBusinessDay outside a BusinessDayProvider — the group layout must supply the business day.',
    )
  }
  return v
}

/** Just the date, for the date-field defaults. */
export function useBusinessToday(): string {
  return useBusinessDay().businessDate
}

/**
 * Said out loud, but ONLY when the two disagree.
 *
 * Between midnight and the cutover the date field reads a day earlier than
 * the phone does, and without a sentence the natural thing for a cashier to
 * do is correct it. On every other hour of the day this renders nothing — a
 * permanent notice restating the obvious is one people stop reading.
 */
export function BusinessDayNote({ className = '' }: { className?: string }) {
  const { businessDate, calendarDate, dayStart } = useBusinessDay()
  if (businessDate === calendarDate) return null
  return (
    <p
      className={`rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-stone-700 ${className}`}
    >
      <span className="font-medium">Business day {fmtDate(businessDate)}.</span> It is past
      midnight and the day does not turn over until {dayStart}, so anything entered now belongs to{' '}
      {fmtDate(businessDate)} — not {fmtDate(calendarDate)}. The dates below are already right;
      leave them.
    </p>
  )
}

/** The inline form, for sitting beside a date field in a tight row. */
export function BusinessDayPill() {
  const { businessDate, calendarDate } = useBusinessDay()
  if (businessDate === calendarDate) return null
  return (
    <span className="text-xs text-doubt">
      business day — past midnight, still {fmtDate(businessDate)}
    </span>
  )
}
