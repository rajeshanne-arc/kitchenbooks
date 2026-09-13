'use server'
import { z } from 'zod'
import type postgres from 'postgres'
import { parseCsv } from '@/lib/csv'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MONEY = /^\d{1,7}(\.\d{1,2})?$/
const HEADERS = ['name', 'designation', 'section', 'employment_type', 'base_salary', 'pay_mode', 'joined', 'phone', 'status']
type StaffImportRow = { name: string; designation: string; section: string; employmentType: string; baseSalary: string; payMode: string; joined: string; phone: string; status: string }
type PreparedStaff = { restaurant_id: string; code: string; name: string; designation: string | null; section_id: string | null; employment_type: string; base_salary: string | null; pay_mode: string | null; joined: string | null; phone: string | null; status: string }

function parseStaff(csv: string): StaffImportRow[] {
  const rows = parseCsv(csv)
  if (rows.length < 2 || rows.length > 501) throw new Error('CSV must contain a header and between 1 and 500 staff rows')
  const header = rows[0].map((x) => x.trim().toLowerCase())
  if (header.length !== HEADERS.length || header.some((x, i) => x !== HEADERS[i])) throw new Error(`Use exactly these columns: ${HEADERS.join(',')}`)
  return rows.slice(1).map((r, i) => {
    if (r.length !== HEADERS.length) throw new Error(`Row ${i + 2} has ${r.length} columns; expected ${HEADERS.length}`)
    const [name, designation, section, employmentType, baseSalary, payMode, joined, phone, status] = r.map((x) => x.trim())
    if (!name || name.length > 120) throw new Error(`Row ${i + 2}: name is required`)
    if (!['full_time', 'trainee', 'contract'].includes(employmentType)) throw new Error(`Row ${i + 2}: employment_type must be full_time, trainee, or contract`)
    if (baseSalary && (!MONEY.test(baseSalary) || Number(baseSalary) <= 0)) throw new Error(`Row ${i + 2}: base_salary must be a positive amount`)
    if (payMode && !['account', 'cash'].includes(payMode)) throw new Error(`Row ${i + 2}: pay_mode must be account or cash`)
    if (joined && !DATE.test(joined)) throw new Error(`Row ${i + 2}: joined must be YYYY-MM-DD`)
    if (status && !['active', 'inactive'].includes(status)) throw new Error(`Row ${i + 2}: status must be active or inactive`)
    return { name, designation, section, employmentType, baseSalary, payMode, joined, phone, status: status || 'active' }
  })
}

async function prepare(tx: postgres.TransactionSql, rid: string, parsed: StaffImportRow[]): Promise<PreparedStaff[]> {
  const sections = await tx<{ id: string; name: string }[]>`select id, name from sections where restaurant_id = ${rid} and status = 'active'`
  const sectionMap = new Map<string, string>()
  for (const section of sections) { const key = section.name.trim().toLowerCase(); if (sectionMap.has(key)) throw new Error(`Duplicate active section name: ${section.name}`); sectionMap.set(key, section.id) }
  for (const [i, row] of parsed.entries()) if (row.section && !sectionMap.has(row.section.toLowerCase())) throw new Error(`Row ${i + 2}: active section not found: ${row.section}`)
  const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(nullif(substring(code from 2), '')::int), 0) as next from staff where restaurant_id = ${rid} and code ~ '^E[0-9]+$'`
  return parsed.map((row, i) => ({ restaurant_id: rid, code: `E${String(next + i + 1).padStart(3, '0')}`, name: row.name, designation: row.designation || null, section_id: row.section ? sectionMap.get(row.section.toLowerCase()) ?? null : null, employment_type: row.employmentType, base_salary: row.baseSalary || null, pay_mode: row.payMode || null, joined: row.joined || null, phone: row.phone || null, status: row.status }))
}

async function authorized() { const user = await getSessionUser(); if (!user || !['manager', 'owner'].includes(user.role)) throw new Error('Only a manager or owner can import staff'); return user }

export async function previewStaffCsv(raw: { csv: string }): Promise<{ ok: true; count: number; firstCodes: string[]; sections: number } | { ok: false; error: string }> {
  try { const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw); await authorized(); const parsed = parseStaff(input.csv); const rid = (await getRestaurant()).id; const prepared = await txn((tx) => prepare(tx, rid, parsed)); return { ok: true, count: prepared.length, firstCodes: prepared.slice(0, 5).map((r) => r.code), sections: new Set(prepared.map((r) => r.section_id).filter(Boolean)).size } } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Staff preview failed' } }
}

export async function importStaffCsv(raw: { csv: string }): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try { const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw); await authorized(); const parsed = parseStaff(input.csv); const rid = (await getRestaurant()).id; await txn(async (tx) => { await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`; const output = await prepare(tx, rid, parsed); await tx`insert into staff ${tx(output, 'restaurant_id', 'code', 'name', 'designation', 'section_id', 'employment_type', 'base_salary', 'pay_mode', 'joined', 'phone', 'status')}` }); return { ok: true, count: parsed.length } } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Staff import failed — nothing was written' } }
}

export const staffImportContract = async () => 'CSV columns: name,designation,section,employment_type,base_salary,pay_mode,joined,phone,status. Codes are assigned as permanent E### values; bank/statutory identifiers are entered separately.'
