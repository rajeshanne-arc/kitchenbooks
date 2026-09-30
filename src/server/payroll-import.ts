'use server'
import { z } from 'zod'
import { parseCsv } from '@/lib/csv'
import { tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { preparePayrollRun } from '@/server/payroll-actions'
const HEADERS = ['period_start', 'period_end', 'staff_code', 'days_in_period', 'days_paid', 'base_salary', 'earned', 'overtime', 'advance_recovered', 'other_deduction', 'withholding', 'note']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DAYS = /^\d{1,3}(\.\d{1,2})?$/
const MONEY = /^\d{1,11}(\.\d{1,2})?$/
async function validatePayroll(raw: string) {
  const rows = parseCsv(raw)
  if (rows.length < 2 || rows.length > 501) throw new Error('CSV must contain a header and between 1 and 500 payroll rows')
  const header = rows[0].map((x) => x.trim().toLowerCase())
  if (header.length !== HEADERS.length || header.some((x, i) => x !== HEADERS[i])) throw new Error('Use exactly these columns: ' + HEADERS.join(','))
  const parsed = rows.slice(1).map((r, i) => { if (r.length !== HEADERS.length) throw new Error('Row ' + (i + 2) + ' has ' + r.length + ' columns; expected ' + HEADERS.length); const [from, to, code, daysIn, daysPaid, base, earned, overtime, advance, other, withholding, note] = r.map((x) => x.trim()); if (!DATE.test(from) || !DATE.test(to) || !code) throw new Error('Row ' + (i + 2) + ': period dates and staff_code are required'); if (![daysIn, daysPaid].every((x) => DAYS.test(x))) throw new Error('Row ' + (i + 2) + ': day values are invalid'); if ([base, earned, overtime, advance, other, withholding].some((x) => !MONEY.test(x))) throw new Error('Row ' + (i + 2) + ': money values are invalid'); if (Number(daysPaid) > Number(daysIn)) throw new Error('Row ' + (i + 2) + ': days_paid exceeds days_in_period'); return { from, to, code, daysIn, daysPaid, base, earned, overtime, advance, other, withholding, note } })
  if (new Set(parsed.map((x) => x.from + ':' + x.to)).size !== 1) throw new Error('One payroll import must contain exactly one period')
  return parsed
}
async function authorized() { const user = await getSessionUser(); if (!user || !['accountant', 'owner'].includes(user.role)) throw new Error('Only an accountant or owner can import payroll') }
export async function previewPayrollCsv(raw: { csv: string }): Promise<{ ok: true; periodStart: string; periodEnd: string; count: number } | { ok: false; error: string }> {
  try { const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw); await authorized(); const parsed = await validatePayroll(input.csv); const rid = (await getRestaurant()).id; const staff = await tsql<{ id: string; code: string }[]>`select id, code from staff where restaurant_id = ${rid} and code = any(${parsed.map((x) => x.code)}::text[])`; const byCode = new Map(staff.map((x) => [x.code.toLowerCase(), x.id])); const seen = new Set<string>(); for (const [i, row] of parsed.entries()) { const id = byCode.get(row.code.toLowerCase()); if (!id) throw new Error('Row ' + (i + 2) + ': staff code not found in this restaurant: ' + row.code); if (seen.has(id)) throw new Error('Row ' + (i + 2) + ': staff code is duplicated'); seen.add(id) }; return { ok: true, periodStart: parsed[0].from, periodEnd: parsed[0].to, count: parsed.length } }
  catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Payroll preview failed — nothing was written' } }
}
export async function importPayrollCsv(raw: { csv: string }): Promise<{ ok: true; runId: string; count: number } | { ok: false; error: string }> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw)
    await authorized()
    const rows = parseCsv(input.csv)
    if (rows.length < 2 || rows.length > 501) throw new Error('CSV must contain a header and between 1 and 500 payroll rows')
    const header = rows[0].map((x) => x.trim().toLowerCase())
    if (header.length !== HEADERS.length || header.some((x, i) => x !== HEADERS[i])) throw new Error('Use exactly these columns: ' + HEADERS.join(','))
    const parsed = rows.slice(1).map((r, i) => {
      if (r.length !== HEADERS.length) throw new Error('Row ' + (i + 2) + ' has ' + r.length + ' columns; expected ' + HEADERS.length)
      const [from, to, code, daysIn, daysPaid, base, earned, overtime, advance, other, withholding, note] = r.map((x) => x.trim())
      if (!DATE.test(from) || !DATE.test(to) || !code) throw new Error('Row ' + (i + 2) + ': period dates and staff_code are required')
      if (![daysIn, daysPaid].every((x) => DAYS.test(x))) throw new Error('Row ' + (i + 2) + ': day values are invalid')
      if ([base, earned, overtime, advance, other, withholding].some((x) => !MONEY.test(x))) throw new Error('Row ' + (i + 2) + ': money values are invalid')
      if (Number(daysPaid) > Number(daysIn)) throw new Error('Row ' + (i + 2) + ': days_paid exceeds days_in_period')
      return { from, to, code, daysIn, daysPaid, base, earned, overtime, advance, other, withholding, note }
    })
    const periods = new Set(parsed.map((x) => x.from + ':' + x.to))
    if (periods.size !== 1) throw new Error('One payroll import must contain exactly one period')
    const rid = (await getRestaurant()).id
    const staff = await tsql<{ id: string; code: string }[]>`select id, code from staff where restaurant_id = ${rid} and code = any(${parsed.map((x) => x.code)}::text[])`
    const byCode = new Map(staff.map((x) => [x.code.toLowerCase(), x.id]))
    const seen = new Set<string>()
    const lines = parsed.map((x, i) => { const id = byCode.get(x.code.toLowerCase()); if (!id) throw new Error('Row ' + (i + 2) + ': staff code not found in this restaurant: ' + x.code); if (seen.has(id)) throw new Error('Row ' + (i + 2) + ': staff code is duplicated'); seen.add(id); return { staffId: id, daysInPeriod: x.daysIn, daysPaid: x.daysPaid, baseSalary: x.base, earned: x.earned, overtime: x.overtime, advanceRecovered: x.advance, otherDeduction: x.other, withholding: x.withholding, note: x.note } })
    const result = await preparePayrollRun({ periodStart: parsed[0].from, periodEnd: parsed[0].to, note: 'CSV payroll import', lines })
    if (!result.ok) return result
    return { ok: true, runId: result.run.id, count: lines.length }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Payroll import failed — nothing was written' } }
}
export const payrollImportContract = async () => 'CSV columns: period_start,period_end,staff_code,days_in_period,days_paid,base_salary,earned,overtime,advance_recovered,other_deduction,withholding,note. One period per file; values are frozen exactly through the normal prepare workflow.'
