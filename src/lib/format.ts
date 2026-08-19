// Date/time display helpers. All bookkeeping happens in IST.

/** 'YYYY-MM-DD' -> '9 Aug 2026' */
export const fmtDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** Postgres timestamptz::text -> '9 Aug 2026, 8:54 pm' in IST. Postgres emits
 * '2026-08-09 16:23:45.1+00'; JS Date needs the 'T' and a full '+00:00' offset. */
export const fmtDateTime = (ts: string): string =>
  new Date(ts.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })

/** '2026-08-01','2026-08-17' -> '1–17 Aug 2026'; collapses the parts the two
 *  ends share, so a period reads as a phrase rather than two dates.
 *  A period control that names only its preset ("This month") leaves the
 *  reader guessing whether "this month" ends today or at month end. */
export function fmtRange(from: string, to: string): string {
  if (from === to) return fmtDate(from)
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric' })
  const monYear = (d: Date) => d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  const mon = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  if (a.getFullYear() === b.getFullYear()) {
    if (a.getMonth() === b.getMonth()) return `${day(a)}–${day(b)} ${monYear(b)}`
    return `${mon(a)} – ${mon(b)} ${b.getFullYear()}`
  }
  return `${fmtDate(from)} – ${fmtDate(to)}`
}
