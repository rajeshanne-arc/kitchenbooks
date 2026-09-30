'use server'

import { z } from 'zod'
import { parseCsv as readCsv } from '@/lib/csv'
import { tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSettingValue } from '@/server/settings'
import { saveAdjustments } from '@/server/adjustment-actions'
import type { SaveAdjustmentsResult } from '@/lib/types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const QTY_RE = /^\d{1,8}(\.\d{1,3})?$/
function parseCsv(raw: string): { code: string; qty: string }[] {
  const rows = readCsv(raw)
  if (rows.length === 0) throw new Error('Paste CSV rows with columns code,quantity')
  const first = rows[0].map((x) => x.trim().toLowerCase())
  const hasHeader = first[0] === 'code' && (first[1] === 'quantity' || first[1] === 'qty')
  const data = hasHeader ? rows.slice(1) : rows
  if (data.length === 0) throw new Error('The CSV has a header but no stock rows')
  if (data.length > 500) throw new Error('Import at most 500 opening-stock rows at a time')
  return data.map((row, index) => {
    if (row.length !== 2) throw new Error(`CSV row ${index + 1}: expected code and quantity`)
    const [code = '', qty = ''] = row.map((x) => x.trim())
    if (code === '' || qty === '') throw new Error(`CSV row ${index + 1}: code and quantity are required`)
    if (!QTY_RE.test(qty) || Number(qty) <= 0) throw new Error(`CSV row ${index + 1}: quantity must be positive, with up to 3 decimals`)
    return { code: code.slice(0, 80), qty }
  })
}
export async function previewOpeningStockCsv(raw: { date: string; csv: string; note: string }): Promise<{ ok: true; date: string; count: number; pending: boolean } | { ok: false; error: string }> {
  try {
    const input = z.object({ date: z.string().regex(DATE_RE), csv: z.string().trim().min(1), note: z.string().trim().max(300) }).parse(raw)
    const parsed = parseCsv(input.csv); const seen = new Set<string>(); for (const row of parsed) { const key = row.code.toLowerCase(); if (seen.has(key)) throw new Error(`The CSV repeats item code “${row.code}” — combine it into one row`); seen.add(key) }
    const restaurant = await getRestaurant(); const codes = parsed.map((row) => row.code); const items = await tsql<{ id: string; code: string }[]>`select id, code from items where restaurant_id = ${restaurant.id} and status = 'active' and lower(code) = any(${codes.map((code) => code.toLowerCase())})`; const byCode = new Set(items.map((item) => item.code.toLowerCase())); const missing = parsed.filter((row) => !byCode.has(row.code.toLowerCase())).map((row) => row.code); if (missing.length > 0) throw new Error(`These item codes are not active in this restaurant: ${missing.join(', ')}`)
    return { ok: true, date: input.date, count: parsed.length, pending: (await getSettingValue(restaurant.id, 'stock_adjustment_approval_mode')) === 'owner' }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'Date, CSV, or note is invalid' : error instanceof Error ? error.message : 'Opening-stock preview failed — nothing was written' } }
}

export async function importOpeningStockCsv(raw: {
  date: string
  csv: string
  note: string
}): Promise<SaveAdjustmentsResult> {
  try {
    const input = z.object({ date: z.string().regex(DATE_RE), csv: z.string().trim().min(1), note: z.string().trim().max(300) }).parse(raw)
    const parsed = parseCsv(input.csv)
    const seen = new Set<string>()
    for (const row of parsed) {
      const key = row.code.toLowerCase()
      if (seen.has(key)) throw new Error(`The CSV repeats item code “${row.code}” — combine it into one row`)
      seen.add(key)
    }
    const restaurant = await getRestaurant()
    const codes = parsed.map((row) => row.code)
    const items = await tsql<{ id: string; code: string }[]>`
      select id, code from items
      where restaurant_id = ${restaurant.id} and status = 'active' and lower(code) = any(${codes.map((code) => code.toLowerCase())})`
    const byCode = new Map(items.map((item) => [item.code.toLowerCase(), item]))
    const missing = parsed.filter((row) => !byCode.has(row.code.toLowerCase())).map((row) => row.code)
    if (missing.length > 0) throw new Error(`These item codes are not active in this restaurant: ${missing.join(', ')}`)
    const result = await saveAdjustments({
      date: input.date,
      reason: 'Opening stock import',
      note: input.note === '' ? 'CSV opening-stock import' : input.note,
      lines: parsed.map((row) => ({ itemId: byCode.get(row.code.toLowerCase())!.id, qty: row.qty })),
    })
    return result
  } catch (error) {
    const message = error instanceof z.ZodError ? 'Date, CSV, or note is invalid' : error instanceof Error ? error.message : 'The import could not be read'
    return { ok: false, error: message }
  }
}

export async function openingStockImportContract() {
  return 'CSV columns: code,quantity. Quantities are positive purchase units; rates are read from each item’s existing cost and never imported.'
}
