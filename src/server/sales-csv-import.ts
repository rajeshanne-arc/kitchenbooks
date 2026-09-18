'use server'
import { z } from 'zod'
import { parseCsv } from '@/lib/csv'
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { businessToday } from '@/server/business-day'
import { persistFetch, classifyStatus, posNum, type NormalizedPayload, type ParsedOrder } from '@/server/sales-ingest'
const HEADERS = ['business_date', 'pos_order_id', 'status', 'order_total', 'payment_mode', 'channel', 'subtotal', 'tax']
const DATE = /^\d{4}-\d{2}-\d{2}$/
async function parseSales(raw: string) {
  const rows = parseCsv(raw)
  if (rows.length < 2 || rows.length > 10_001) throw new Error('CSV must contain a header and between 1 and 10,000 sales rows')
  const header = rows[0].map((x) => x.trim().toLowerCase())
  if (header.length !== HEADERS.length || header.some((x, i) => x !== HEADERS[i])) throw new Error('Use exactly these columns: ' + HEADERS.join(','))
  const parsed = rows.slice(1).map((r, i) => { if (r.length !== HEADERS.length) throw new Error('Row ' + (i + 2) + ' has ' + r.length + ' columns; expected ' + HEADERS.length); const [date, id, status, total, payment, channel, subtotal, tax] = r.map((x) => x.trim()); if (!DATE.test(date) || !id || id.length > 40) throw new Error('Row ' + (i + 2) + ': business_date and pos_order_id are required'); if (posNum(total) === null || Number(total) < 0) throw new Error('Row ' + (i + 2) + ': order_total is invalid'); if (subtotal && posNum(subtotal) === null) throw new Error('Row ' + (i + 2) + ': subtotal is invalid'); if (tax && posNum(tax) === null) throw new Error('Row ' + (i + 2) + ': tax is invalid'); return { date, id, status: status || 'Success', total, payment: payment || null, channel: channel || null, subtotal: subtotal || null, tax: tax || null } })
  if (new Set(parsed.map((x) => x.date)).size !== 1) throw new Error('One import must contain exactly one business date')
  const date = parsed[0].date; if (date > await businessToday()) throw new Error('That date has not happened yet — import today or an earlier date')
  const ids = new Set<string>(); for (const row of parsed) { if (ids.has(row.id)) throw new Error('Duplicate pos_order_id in this file: ' + row.id); ids.add(row.id) }
  const orders: ParsedOrder[] = parsed.map((row) => ({ pos_order_id: row.id, order_time_local: null, channel: row.channel, order_type: null, payment_mode: row.payment, covers: null, status_raw: row.status, status_class: classifyStatus(row.status), subtotal: row.subtotal, discount: null, tax: row.tax, service_charge: null, container: null, round_off: null, order_total: row.total, lines: [] }))
  const norm: NormalizedPayload = { orders, apiOrderCount: orders.length, skippedOtherDates: 0, otherDates: {}, duplicateIds: 0, withTime: 0, compDisagreements: 0, note: 'CSV sales import', census: { topKeys: [], orderKeys: [], itemKeys: [], candidates: { itemCode: [], leakage: [] } } }
  return { date, norm }
}
async function authorized() { const user = await getSessionUser(); if (!user || !['cashier', 'manager', 'owner', 'accountant'].includes(user.role)) throw new Error('Only an authorized sales or accounts user can import sales') }
export async function previewSalesCsv(raw: { csv: string }): Promise<{ ok: true; date: string; count: number } | { ok: false; error: string }> {
  try { const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw); await authorized(); const result = await parseSales(input.csv); return { ok: true, date: result.date, count: result.norm.orders.length } } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Sales preview failed — nothing was written' } }
}
export async function importSalesCsv(raw: { csv: string }): Promise<{ ok: true; date: string; count: number } | { ok: false; error: string }> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw)
    await authorized(); const { date, norm } = await parseSales(input.csv)
    const rid = (await getRestaurant()).id
    await persistFetch(rid, date, norm)
    return { ok: true, date, count: norm.orders.length }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Sales import failed — nothing was written' } }
}
export const salesImportContract = async () => 'CSV columns: business_date,pos_order_id,status,order_total,payment_mode,channel,subtotal,tax. One business date per file; status uses the same POS whitelist and the normal immutable sales-generation and journal path.'
