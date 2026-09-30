'use server'
import { z } from 'zod'
import { parseCsv } from '@/lib/csv'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
const HEADERS = ['code', 'name', 'type']
const TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense'])
export async function importAccountsCsv(raw: { csv: string }): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw)
    const user = await getSessionUser()
    if (!user || !['accountant', 'owner'].includes(user.role)) throw new Error('Only an accountant or owner can import ledger accounts')
    const rows = parseCsv(input.csv)
    if (rows.length < 2 || rows.length > 501) throw new Error('CSV must contain a header and between 1 and 500 account rows')
    const header = rows[0].map((x) => x.trim().toLowerCase())
    if (header.length !== HEADERS.length || header.some((x, i) => x !== HEADERS[i])) throw new Error('Use exactly these columns: ' + HEADERS.join(','))
    const parsed = rows.slice(1).map((r, i) => {
      if (r.length !== HEADERS.length) throw new Error('Row ' + (i + 2) + ' has ' + r.length + ' columns; expected ' + HEADERS.length)
      const [code, name, type] = r.map((x) => x.trim())
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(code) || !name || name.length > 120) throw new Error('Row ' + (i + 2) + ': code and name are invalid')
      if (!TYPES.has(type)) throw new Error('Row ' + (i + 2) + ': type must be asset, liability, equity, revenue, or expense')
      return { code: code.toUpperCase(), name, type }
    })
    const codes = new Set<string>(); for (const [i, row] of parsed.entries()) { if (codes.has(row.code)) throw new Error('Row ' + (i + 2) + ': account code is duplicated'); codes.add(row.code) }
    const rid = (await getRestaurant()).id
    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const existing = await tx<{ code: string }[]>`select code from accounting_accounts where restaurant_id = ${rid} and code = any(${parsed.map((x) => x.code)}::text[])`
      if (existing.length) throw new Error('Account code already exists: ' + existing[0].code)
      const output = parsed.map((row) => ({ restaurant_id: rid, code: row.code, name: row.name, account_type: row.type }))
      await tx`insert into accounting_accounts ${tx(output, 'restaurant_id', 'code', 'name', 'account_type')}`
    })
    return { ok: true, count: parsed.length }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Account import failed — nothing was written' } }
}
export async function previewAccountsCsv(raw: { csv: string }): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw)
    const user = await getSessionUser()
    if (!user || !['accountant', 'owner'].includes(user.role)) throw new Error('Only an accountant or owner can import ledger accounts')
    const rows = parseCsv(input.csv)
    if (rows.length < 2 || rows.length > 501) throw new Error('CSV must contain a header and between 1 and 500 account rows')
    const header = rows[0].map((x) => x.trim().toLowerCase())
    if (header.length !== HEADERS.length || header.some((x, i) => x !== HEADERS[i])) throw new Error('Use exactly these columns: ' + HEADERS.join(','))
    const codes = new Set<string>()
    for (const [i, r] of rows.slice(1).entries()) {
      if (r.length !== HEADERS.length) throw new Error('Row ' + (i + 2) + ' has ' + r.length + ' columns; expected ' + HEADERS.length)
      const [code, name, type] = r.map((x) => x.trim()); const normalized = code.toUpperCase()
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(code) || !name || name.length > 120 || !TYPES.has(type)) throw new Error('Row ' + (i + 2) + ': account fields are invalid')
      if (codes.has(normalized)) throw new Error('Row ' + (i + 2) + ': account code is duplicated'); codes.add(normalized)
    }
    const rid = (await getRestaurant()).id
    await txn(async (tx) => { const existing = await tx<{ code: string }[]>`select code from accounting_accounts where restaurant_id = ${rid} and code = any(${[...codes]}::text[])`; if (existing.length) throw new Error('Account code already exists: ' + existing[0].code) })
    return { ok: true, count: rows.length - 1 }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Account preview failed — nothing was written' } }
}
export const accountsImportContract = async () => 'CSV columns: code,name,type. Supported types: asset,liability,equity,revenue,expense. Importing accounts does not create posting mappings or opening balances.'
