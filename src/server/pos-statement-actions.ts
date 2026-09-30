'use server'

import { z } from 'zod'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { listPosStatementComparisons, type PosStatementComparison } from '@/server/pos-statement-queries'
import { parseCsv } from '@/lib/csv'
import { decimalStringToPaise, paiseToString } from '@/lib/money'

const DATE = /^\d{4}-\d{2}-\d{2}$/
type ParsedStatementRow = { date: string; amount: string; orderId: string | null; payment: string | null; status: string | null }

function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return parsed.toISOString().slice(0, 10) === value
}

async function authorized() {
  const user = await getSessionUser()
  if (!user || !['cashier', 'manager', 'owner', 'accountant'].includes(user.role)) throw new Error('Only an authorized sales or accounts user can import a POS statement')
  return user
}

function parseStatement(csv: string): ParsedStatementRow[] {
  const rows = parseCsv(csv)
  const header = (rows[0] ?? []).map((x) => x.trim().toLowerCase())
  const hasHeader = header[0] === 'business_date' && header[1] === 'amount'
  const data = hasHeader ? rows.slice(1) : rows
  if (data.length === 0 || data.length > 10000) throw new Error('The statement must contain between 1 and 10,000 rows')
  return data.map((line, index) => {
    if (line.length < 2 || line.length > 5) throw new Error(`Statement row ${index + 1}: use business_date,amount[,order_id,payment_mode,status]`)
    const [date = '', amount = '', orderId = '', payment = '', status = ''] = line.map((x) => x.trim())
    if (!isRealDate(date) || !/^\d{1,11}(\.\d{1,2})?$/.test(amount)) throw new Error(`Statement row ${index + 1}: use a real business_date and valid amount`)
    return { date, amount, orderId: orderId.slice(0, 80) || null, payment: payment.slice(0, 60) || null, status: status.slice(0, 60) || null }
  })
}

export async function previewPosStatement(raw: { csv: string }): Promise<{ ok: true; rows: number; dates: number; total: string } | { ok: false; error: string }> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(1_000_000) }).parse(raw)
    await authorized()
    const parsed = parseStatement(input.csv)
    const totalPaise = parsed.reduce((sum, row) => sum + decimalStringToPaise(row.amount), 0)
    return { ok: true, rows: parsed.length, dates: new Set(parsed.map((row) => row.date)).size, total: paiseToString(totalPaise) }
  } catch (error) {
    return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Statement preview failed — nothing was written' }
  }
}

export async function importPosStatement(raw: { csv: string; note: string }): Promise<{ ok: true; comparisons: PosStatementComparison[] } | { ok: false; error: string }> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(1_000_000), note: z.string().trim().max(300) }).parse(raw)
    const user = await authorized()
    const parsed = parseStatement(input.csv)
    const restaurant = await getRestaurant(); const rid = restaurant.id
    await txn(async (tx) => {
      const [imp] = await tx<{ id: string }[]>`insert into pos_statement_imports (restaurant_id, imported_by, note) values (${rid}, ${user.username}, ${input.note === '' ? null : input.note}) returning id`
      const rowsToInsert = parsed.map((row) => ({ restaurant_id: rid, import_id: imp.id, business_date: row.date, pos_order_id: row.orderId, amount: row.amount, payment_mode: row.payment, status: row.status }))
      await tx`insert into pos_statement_lines ${tx(rowsToInsert, 'restaurant_id', 'import_id', 'business_date', 'pos_order_id', 'amount', 'payment_mode', 'status')}`
    })
    return { ok: true, comparisons: await listPosStatementComparisons(rid) }
  } catch (error) {
    return { ok: false, error: error instanceof z.ZodError ? 'Use CSV columns business_date,amount[,order_id,payment_mode,status]' : error instanceof Error ? error.message : 'The statement could not be imported' }
  }
}
