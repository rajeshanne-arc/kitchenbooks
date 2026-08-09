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

/** Postgres timestamptz::text -> '9 Aug 2026, 8:54 pm' in IST */
export const fmtDateTime = (ts: string): string =>
  new Date(ts.replace(' ', 'T')).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })
