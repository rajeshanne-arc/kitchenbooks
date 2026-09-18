'use server'
import { z } from 'zod'
import { parseCsv } from '@/lib/csv'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'

const HEADERS = ['name', 'category', 'gstin', 'phone', 'payment_terms']
const clean = (value: string) => value.trim()
type Parsed = { name: string; category: string; gstin: string; phone: string; paymentTerms: string }

function parseVendors(raw: string): Parsed[] {
  const rows = parseCsv(raw)
  if (rows.length < 2 || rows.length > 501) throw new Error('CSV must contain a header and between 1 and 500 vendor rows')
  const header = rows[0].map((x) => clean(x).toLowerCase())
  if (header.length !== HEADERS.length || header.some((x, i) => x !== HEADERS[i])) throw new Error('Use exactly these columns: ' + HEADERS.join(','))
  const names = new Set<string>()
  return rows.slice(1).map((r, i) => {
    if (r.length !== HEADERS.length) throw new Error('Row ' + (i + 2) + ' has ' + r.length + ' columns; expected ' + HEADERS.length)
    const [name, category, gstin, phone, paymentTerms] = r.map(clean)
    if (!name || name.length > 120) throw new Error('Row ' + (i + 2) + ': name is required')
    if (!category || category.length > 16) throw new Error('Row ' + (i + 2) + ': category is required')
    if (gstin.length > 20 || phone.length > 20 || paymentTerms.length > 120) throw new Error('Row ' + (i + 2) + ': a field is too long')
    if (names.has(name.toLowerCase())) throw new Error('Row ' + (i + 2) + ': vendor name is duplicated in this file')
    names.add(name.toLowerCase())
    return { name, category, gstin, phone, paymentTerms }
  })
}

async function prepare(tx: Parameters<Parameters<typeof txn>[0]>[0], rid: string, parsed: Parsed[]) {
  const categories = await tx<{ code: string }[]>`select code from categories where status = 'active' and code = any(${parsed.map((r) => r.category)}::text[])`
  const known = new Set(categories.map((c) => c.code))
  for (const row of parsed) if (!known.has(row.category)) throw new Error('Unknown active category “' + row.category + '”')
  const duplicates = await tx<{ name: string }[]>`select name from vendors where restaurant_id = ${rid} and lower(name) = any(${parsed.map((r) => r.name.toLowerCase())}::text[])`
  if (duplicates.length > 0) throw new Error('Vendor already exists: ' + duplicates[0].name)
  const counters = new Map<string, number>()
  for (const category of new Set(parsed.map((row) => row.category))) {
    const [n] = await tx<{ next: number }[]>`select coalesce(max(nullif(split_part(code, '-', 3), '')::int), 0) + 1 as next from vendors where restaurant_id = ${rid} and code like ${'V-' + category + '-%'}`
    counters.set(category, n.next)
  }
  return parsed.map((row) => { const next = counters.get(row.category) ?? 1; counters.set(row.category, next + 1); return { restaurant_id: rid, code: 'V-' + row.category + '-' + String(next).padStart(2, '0'), name: row.name, primary_category: row.category, gstin: row.gstin || null, phone: row.phone || null, payment_terms: row.paymentTerms || null } })
}

async function authorized() {
  const user = await getSessionUser()
  if (!user || !['store', 'manager', 'owner'].includes(user.role)) throw new Error('Only the store, a manager, or an owner can import vendors')
}

export async function previewVendorsCsv(raw: { csv: string }): Promise<{ ok: true; count: number; firstCodes: string[] } | { ok: false; error: string }> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw); await authorized()
    const parsed = parseVendors(input.csv); const rid = (await getRestaurant()).id
    const codes = await txn(async (tx) => { await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`; return (await prepare(tx, rid, parsed)).map((row) => row.code) })
    return { ok: true, count: parsed.length, firstCodes: codes.slice(0, 5) }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Vendor preview failed — nothing was written' } }
}

export async function importVendorsCsv(raw: { csv: string }): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw); await authorized()
    const parsed = parseVendors(input.csv); const rid = (await getRestaurant()).id
    await txn(async (tx) => { await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`; const output = await prepare(tx, rid, parsed); await tx`insert into vendors ${tx(output, 'restaurant_id', 'code', 'name', 'primary_category', 'gstin', 'phone', 'payment_terms')}` })
    return { ok: true, count: parsed.length }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Vendor import failed — nothing was written' } }
}
export const vendorImportContract = async () => 'CSV columns: name,category,gstin,phone,payment_terms. Vendor codes are assigned by category; banking, contacts, supplies, and notes are entered on the vendor record afterward.'
