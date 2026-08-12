// The financial year, as a label — pure, so it can be asserted by value.
//
// PHASE C GLOBAL RULE: nothing here encodes one country's calendar. The
// year that a restaurant's books run on is a SETTING (`fy_start_month`,
// 1–12), because April is India, July is Australia, October is the US
// federal year, and January is most of the rest. Reading it from settings
// is the whole reason this file exists instead of a constant.
//
// The label is what a document number wears: PUR-2627-0001. It is always
// FOUR characters so numbers stay aligned in a column of them:
//
//   a year that SPANS two calendar years -> both, two digits each: '2627'
//   a year that IS a calendar year       -> that year in full:     '2026'
//
// Rolling a century is not special-cased because it does not need to be:
// 2099-04 lands on '9900', which still sorts and still reads.

/** January, the least-assuming default: it is a calendar year, and no
 *  country's tax law is baked in by choosing it. Used only when the
 *  setting is missing or unreadable — a restaurant that has told us its
 *  year is never second-guessed. */
export const DEFAULT_FY_START_MONTH = 1

/** Accepts what a settings row actually holds: a string, or nothing. */
export function parseFyStartMonth(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return DEFAULT_FY_START_MONTH
  const n = Number(raw.trim())
  if (!Number.isInteger(n) || n < 1 || n > 12) return DEFAULT_FY_START_MONTH
  return n
}

/** The FY label a document dated `dateISO` belongs to. */
export function fyLabel(dateISO: string, fyStartMonth: number): string {
  const year = Number(dateISO.slice(0, 4))
  const month = Number(dateISO.slice(5, 7))
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error(`fyLabel needs a YYYY-MM-DD date, got ${dateISO}`)
  }
  if (fyStartMonth === 1) return String(year).padStart(4, '0')
  const start = month >= fyStartMonth ? year : year - 1
  const two = (y: number) => String(((y % 100) + 100) % 100).padStart(2, '0')
  return `${two(start)}${two(start + 1)}`
}

/** The window a label covers, for a register's "which year am I in" header. */
export function fyRange(dateISO: string, fyStartMonth: number): { from: string; to: string } {
  const year = Number(dateISO.slice(0, 4))
  const month = Number(dateISO.slice(5, 7))
  const start = fyStartMonth === 1 || month >= fyStartMonth ? year : year - 1
  const mm = String(fyStartMonth).padStart(2, '0')
  const endYear = fyStartMonth === 1 ? start : start + 1
  const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate()
  return {
    from: `${start}-${mm}-01`,
    to: `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  }
}
