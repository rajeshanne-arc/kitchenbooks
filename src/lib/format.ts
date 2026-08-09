// Date/time display helpers. All bookkeeping happens in IST.

/** 'YYYY-MM-DD' -> '9 Aug 2026' */
export const fmtDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** Local YYYY-MM-DD for date-input defaults */
export function todayLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

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
