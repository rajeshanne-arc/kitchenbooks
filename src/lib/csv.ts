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

/** Small RFC-4180 reader for import forms. Quoted commas, quotes and newlines
 * are handled; malformed quotes are rejected instead of being silently
 * shifted into the next column. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else value += ch
    } else if (ch === '"' && value === '') quoted = true
    else if (ch === ',') { row.push(value); value = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(value); value = ''
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
    } else value += ch
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field')
  if (value !== '' || row.length > 0) { row.push(value); if (row.some((cell) => cell.trim() !== '')) rows.push(row) }
  return rows
}

/** A filename someone can find again in six months without opening it. */
export const csvFilename = (what: string, from: string, to: string): string =>
  `${what}-${from}-to-${to}.csv`.replace(/[^a-zA-Z0-9.\-_]/g, '-')
