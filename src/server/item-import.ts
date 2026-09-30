'use server'
import { z } from 'zod'
import { parseCsv } from '@/lib/csv'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
const HEADERS = ['name', 'category', 'purchase_unit', 'opening_rate', 'storage_location', 'tracks_expiry']
const MONEY = /^\d{1,5}(\.\d{1,2})?$/
type Parsed = { name: string; category: string; purchaseUnit: string; openingRate: string; storageLocation: string; tracksExpiry: boolean }
function parseItems(raw: string): Parsed[] {
  const rows = parseCsv(raw)
  if (rows.length < 2 || rows.length > 501) throw new Error('CSV must contain a header and between 1 and 500 item rows')
  const header = rows[0].map((x) => x.trim().toLowerCase())
  if (header.length !== HEADERS.length || header.some((x, i) => x !== HEADERS[i])) throw new Error('Use exactly these columns: ' + HEADERS.join(','))
  const names = new Set<string>()
  return rows.slice(1).map((r, i) => {
    if (r.length !== HEADERS.length) throw new Error('Row ' + (i + 2) + ' has ' + r.length + ' columns; expected ' + HEADERS.length)
    const [name, category, purchaseUnit, openingRate, storageLocation, expiry] = r.map((x) => x.trim())
    if (!name || name.length > 120) throw new Error('Row ' + (i + 2) + ': name is required')
    if (!category || category.length > 16 || !purchaseUnit || purchaseUnit.length > 16) throw new Error('Row ' + (i + 2) + ': category and purchase_unit are required')
    if (openingRate && (!MONEY.test(openingRate) || Number(openingRate) < 0)) throw new Error('Row ' + (i + 2) + ': opening_rate is invalid')
    if (expiry && !['true', 'false', 'yes', 'no', '1', '0'].includes(expiry.toLowerCase())) throw new Error('Row ' + (i + 2) + ': tracks_expiry must be true or false')
    if (names.has(name.toLowerCase())) throw new Error('Row ' + (i + 2) + ': item name is duplicated in this file')
    names.add(name.toLowerCase())
    return { name, category, purchaseUnit, openingRate, storageLocation, tracksExpiry: ['true', 'yes', '1'].includes(expiry.toLowerCase()) }
  })
}
async function prepare(tx: Parameters<Parameters<typeof txn>[0]>[0], rid: string, parsed: Parsed[]) {
  const categories = await tx<{ code: string }[]>`select code from categories where status = 'active' and code = any(${parsed.map((r) => r.category)}::text[])`
  const units = await tx<{ code: string }[]>`select code from units where code = any(${parsed.map((r) => r.purchaseUnit)}::text[])`
  const knownCategories = new Set(categories.map((x) => x.code)); const knownUnits = new Set(units.map((x) => x.code))
  for (const row of parsed) { if (!knownCategories.has(row.category)) throw new Error('Unknown active category “' + row.category + '”'); if (!knownUnits.has(row.purchaseUnit)) throw new Error('Unknown unit “' + row.purchaseUnit + '”') }
  const locations = await tx<{ id: string; name: string }[]>`select id, name from storage_locations where restaurant_id = ${rid} and status = 'active'`
  const locationMap = new Map(locations.map((x) => [x.name.trim().toLowerCase(), x.id]))
  for (const row of parsed) if (row.storageLocation && !locationMap.has(row.storageLocation.toLowerCase())) throw new Error('Active storage location not found: ' + row.storageLocation)
  const existing = await tx<{ name: string }[]>`select name from items where restaurant_id = ${rid} and lower(name) = any(${parsed.map((r) => r.name.toLowerCase())}::text[])`
  if (existing.length) throw new Error('Item already exists: ' + existing[0].name)
  const counters = new Map<string, number>()
  for (const category of new Set(parsed.map((r) => r.category))) { const [n] = await tx<{ n: number }[]>`select coalesce(max(nullif(split_part(code, '-', 2), '')::int), 0) + 1 as n from items where restaurant_id = ${rid} and code like ${category + '-%'}`; counters.set(category, n.n) }
  return parsed.map((row) => { const n = counters.get(row.category) ?? 1; counters.set(row.category, n + 1); return { restaurant_id: rid, code: row.category + '-' + String(n).padStart(3, '0'), name: row.name, category: row.category, purchase_unit: row.purchaseUnit, opening_rate: row.openingRate || null, tracks_expiry: row.tracksExpiry, storage_location_id: row.storageLocation ? locationMap.get(row.storageLocation.toLowerCase()) ?? null : null, conversion_factor: 1 } })
}
async function authorized() { const user = await getSessionUser(); if (!user || !['store', 'manager', 'owner'].includes(user.role)) throw new Error('Only the store, a manager, or an owner can import items') }
export async function previewItemsCsv(raw: { csv: string }): Promise<{ ok: true; count: number; firstCodes: string[] } | { ok: false; error: string }> {
  try { const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw); await authorized(); const parsed = parseItems(input.csv); const rid = (await getRestaurant()).id; const codes = await txn(async (tx) => { await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`; return (await prepare(tx, rid, parsed)).map((row) => row.code) }); return { ok: true, count: parsed.length, firstCodes: codes.slice(0, 5) }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Item preview failed — nothing was written' } }
}
export async function importItemsCsv(raw: { csv: string }): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try { const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw); await authorized(); const parsed = parseItems(input.csv); const rid = (await getRestaurant()).id; await txn(async (tx) => { await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`; const output = await prepare(tx, rid, parsed); await tx`insert into items ${tx(output, 'restaurant_id', 'code', 'name', 'category', 'purchase_unit', 'opening_rate', 'tracks_expiry', 'storage_location_id', 'conversion_factor')}` }); return { ok: true, count: parsed.length }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Item import failed — nothing was written' } }
}
export const itemImportContract = async () => 'CSV columns: name,category,purchase_unit,opening_rate,storage_location,tracks_expiry. Item codes are assigned by category; optional stock/reorder fields can be completed on the item record.'
