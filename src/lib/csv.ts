// CSV, the boring correct way.
//
// GENERIC TABULAR FIRST — every accounting package on earth takes a CSV, and
// none of them agree on anything more specific. Package-specific mappings
// are configuration for later, never a hardcoded assumption about which
// software the customer bought.
//
// Two details that are not fussiness:
//   - a leading =, +, - or @ makes Excel treat a cell as a FORMULA. A vendor
//     called "-Sons Traders" would execute. Prefixed with an apostrophe.
//   - the BOM makes Excel read UTF-8 rather than mangling every rupee sign
//     and every non-Latin name.

const RISKY = /^[=+\-@\t\r]/

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  const safe = RISKY.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))]
  return `﻿${lines.join('\r\n')}\r\n`
}

/** A filename someone can find again in six months without opening it. */
export const csvFilename = (what: string, from: string, to: string): string =>
  `${what}-${from}-to-${to}.csv`.replace(/[^a-zA-Z0-9.\-_]/g, '-')
