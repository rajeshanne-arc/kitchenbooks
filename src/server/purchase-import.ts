'use server'
import { z } from 'zod'
import { parseCsv } from '@/lib/csv'
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { saveBill } from '@/server/save-bill'
const HEADERS = ['bill_date', 'vendor_code', 'gst_total', 'transport', 'item_code', 'qty', 'rate', 'expiry_date']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MONEY = /^\d{1,5}(\.\d{1,2})?$/
const QTY = /^\d{1,5}(\.\d{1,3})?$/
export async function importPurchaseCsv(raw: { csv: string; dryRun?: boolean }): Promise<{ ok: true; purchaseId: string; preview?: { vendorCode: string; billDate: string; lines: number; goodsValue: string } } | { ok: false; error: string }> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(500_000), dryRun: z.boolean().optional() }).parse(raw)
    const user = await getSessionUser()
    if (!user || !['store', 'manager', 'owner'].includes(user.role)) throw new Error('Only the store, a manager, or an owner can import a purchase bill')
    const rows = parseCsv(input.csv)
    if (rows.length < 2 || rows.length > 41) throw new Error('CSV must contain a header and between 1 and 40 bill lines')
    const header = rows[0].map((x) => x.trim().toLowerCase())
    if (header.length !== HEADERS.length || header.some((x, i) => x !== HEADERS[i])) throw new Error('Use exactly these columns: ' + HEADERS.join(','))
    const parsed = rows.slice(1).map((r, i) => {
      if (r.length !== HEADERS.length) throw new Error('Row ' + (i + 2) + ' has ' + r.length + ' columns; expected ' + HEADERS.length)
      const [date, vendorCode, gst, transport, itemCode, qty, rate, expiry] = r.map((x) => x.trim())
      if (!DATE.test(date) || !vendorCode || !itemCode) throw new Error('Row ' + (i + 2) + ': bill_date, vendor_code, and item_code are required')
      if (!MONEY.test(gst) || !MONEY.test(transport) || !QTY.test(qty) || !MONEY.test(rate)) throw new Error('Row ' + (i + 2) + ': invalid money or quantity')
      if (expiry && !DATE.test(expiry)) throw new Error('Row ' + (i + 2) + ': expiry_date must be YYYY-MM-DD')
      return { date, vendorCode: vendorCode.toUpperCase(), gst, transport, itemCode: itemCode.toUpperCase(), qty, rate, expiry: expiry || undefined }
    })
    const keys = new Set(parsed.map((x) => x.date + '|' + x.vendorCode + '|' + x.gst + '|' + x.transport))
    if (keys.size !== 1) throw new Error('Every row must belong to the same bill date, vendor, GST total, and transport total')
    const rid = (await getRestaurant()).id
    const [vendor] = await tsql<{ id: string }[]>`select id from vendors where restaurant_id = ${rid} and code = ${parsed[0].vendorCode} and status = 'active'`
    if (!vendor) throw new Error('Active vendor code not found: ' + parsed[0].vendorCode)
    const items = await tsql<{ id: string; code: string }[]>`select id, code from items where restaurant_id = ${rid} and code = any(${parsed.map((x) => x.itemCode)}::text[]) and status = 'active'`
    const byCode = new Map(items.map((x) => [x.code.toUpperCase(), x.id]))
    const lines = parsed.map((x, i) => { const id = byCode.get(x.itemCode); if (!id) throw new Error('Row ' + (i + 2) + ': active item code not found: ' + x.itemCode); return { item: { kind: 'existing' as const, id }, qty: x.qty, rate: x.rate, expiryDate: x.expiry } })
    if (input.dryRun) {
      const goodsValue = parsed.reduce((sum, row) => sum + Number(row.qty) * Number(row.rate), 0).toFixed(2)
      return { ok: true, purchaseId: '', preview: { vendorCode: parsed[0].vendorCode, billDate: parsed[0].date, lines: lines.length, goodsValue } }
    }
    const result = await saveBill({ billDate: parsed[0].date, vendor: { kind: 'existing', id: vendor.id }, lines, gstTotal: parsed[0].gst, transport: parsed[0].transport })
    if (!result.ok) return result
    return { ok: true, purchaseId: result.purchase.id }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Purchase import failed — nothing was written' } }
}
export const purchaseImportContract = async () => 'CSV columns: bill_date,vendor_code,gst_total,transport,item_code,qty,rate,expiry_date. One existing-vendor bill per file; every row repeats the bill metadata. Preview validates the complete file without writing; import then uses the normal stock, dues, tax, and journal path.'

const BATCH_HEADERS = ['bill_date', 'bill_no', 'vendor_code', 'gst_total', 'transport', 'item_code', 'qty', 'rate', 'expiry_date'] as const
type BatchRow = { date: string; billNo: string; vendorCode: string; gst: string; transport: string; itemCode: string; qty: string; rate: string; expiry?: string }
type BatchBill = { billNo: string; date: string; vendorCode: string; gst: string; transport: string; rows: BatchRow[] }
type BatchPreview = { bills: number; lines: number; goodsValue: string; billRefs: string[] }

/**
 * Reusable historical-load contract. Every line repeats its bill metadata;
 * rows are grouped by the supplier's bill number, validated in full, and then
 * passed through saveBill inside one outer transaction. The source bill number
 * is retained in purchases.bill_no while KitchenBooks still allocates its own
 * doc_no sequence.
 */
export async function importPurchaseBatchCsv(raw: { csv: string; dryRun?: boolean }): Promise<
  | { ok: true; imported: number; preview?: BatchPreview }
  | { ok: false; error: string }
> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(500_000), dryRun: z.boolean().optional() }).parse(raw)
    const user = await getSessionUser()
    if (!user || !['store', 'manager', 'owner'].includes(user.role)) throw new Error('Only the store, a manager, or an owner can import purchase bills')
    const rows = parseCsv(input.csv)
    if (rows.length < 2 || rows.length > 5001) throw new Error('CSV must contain a header and between 1 and 5,000 bill lines')
    const header = rows[0].map((x) => x.trim().toLowerCase())
    if (header.length !== BATCH_HEADERS.length || header.some((x, i) => x !== BATCH_HEADERS[i])) {
      throw new Error('Use exactly these columns: ' + BATCH_HEADERS.join(','))
    }

    const parsed: BatchRow[] = rows.slice(1).map((r, i) => {
      if (r.length !== BATCH_HEADERS.length) throw new Error(`Row ${i + 2} has ${r.length} columns; expected ${BATCH_HEADERS.length}`)
      const [date, billNo, vendorCode, gst, transport, itemCode, qty, rate, expiry] = r.map((x) => x.trim())
      if (!DATE.test(date) || !billNo || !vendorCode || !itemCode) throw new Error(`Row ${i + 2}: bill_date, bill_no, vendor_code, and item_code are required`)
      if (billNo.length > 120 || !/^[\w./-]+$/.test(billNo)) throw new Error(`Row ${i + 2}: bill_no contains unsupported characters`)
      if (!MONEY.test(gst) || !MONEY.test(transport) || !QTY.test(qty) || !MONEY.test(rate)) throw new Error(`Row ${i + 2}: invalid money or quantity`)
      if (expiry && !DATE.test(expiry)) throw new Error(`Row ${i + 2}: expiry_date must be YYYY-MM-DD`)
      return { date, billNo, vendorCode: vendorCode.toUpperCase(), gst, transport, itemCode: itemCode.toUpperCase(), qty, rate, expiry: expiry || undefined }
    })

    const grouped = new Map<string, BatchBill>()
    for (const row of parsed) {
      // Supplier invoice numbers are not a global namespace: two vendors may
      // both issue INV-100. The vendor is part of the source identity, while
      // a repeated reference for one vendor must still describe one bill.
      const groupKey = `${row.vendorCode}|${row.billNo}`
      const existing = grouped.get(groupKey)
      if (existing === undefined) {
        grouped.set(groupKey, { billNo: row.billNo, date: row.date, vendorCode: row.vendorCode, gst: row.gst, transport: row.transport, rows: [row] })
      } else {
        if (existing.date !== row.date || existing.vendorCode !== row.vendorCode || existing.gst !== row.gst || existing.transport !== row.transport) {
          throw new Error(`Bill ${row.billNo}: every row must repeat the same date, vendor, GST total, and transport total`)
        }
        existing.rows.push(row)
      }
    }
    const bills = [...grouped.values()]
    if (bills.some((bill) => bill.rows.length > 40)) throw new Error('A bill cannot contain more than 40 lines')
    const rid = (await getRestaurant()).id
    const vendorCodes = [...new Set(bills.map((bill) => bill.vendorCode))]
    const vendors = await tsql<{ id: string; code: string }[]>`
      select id, code from vendors
      where restaurant_id = ${rid} and status = 'active' and code = any(${vendorCodes}::text[])`
    const vendorByCode = new Map(vendors.map((vendor) => [vendor.code.toUpperCase(), vendor]))
    for (const bill of bills) if (!vendorByCode.has(bill.vendorCode)) throw new Error(`Active vendor code not found: ${bill.vendorCode}`)

    const itemCodes = [...new Set(parsed.map((row) => row.itemCode))]
    const items = await tsql<{ id: string; code: string }[]>`
      select id, code from items
      where restaurant_id = ${rid} and status = 'active' and code = any(${itemCodes}::text[])`
    const itemByCode = new Map(items.map((item) => [item.code.toUpperCase(), item]))
    for (const row of parsed) if (!itemByCode.has(row.itemCode)) throw new Error(`Item code not found on row ${parsed.indexOf(row) + 2}: ${row.itemCode}`)

    const existingRefs = await tsql<{ bill_no: string; vendor_id: string }[]>`
      select bill_no, vendor_id from purchases
      where restaurant_id = ${rid} and bill_no = any(${bills.map((bill) => bill.billNo)}::text[])`
    const existingKeys = new Set(existingRefs.map((row) => `${row.vendor_id}|${row.bill_no}`))
    for (const bill of bills) {
      const vendor = vendorByCode.get(bill.vendorCode)!
      if (existingKeys.has(`${vendor.id}|${bill.billNo}`)) throw new Error(`Bill ${bill.billNo} for vendor ${bill.vendorCode} already exists — refusing a duplicate import`)
    }

    const preview: BatchPreview = {
      bills: bills.length,
      lines: parsed.length,
      goodsValue: bills.flatMap((bill) => bill.rows).reduce((sum, row) => sum + Number(row.qty) * Number(row.rate), 0).toFixed(2),
      billRefs: bills.map((bill) => bill.billNo),
    }
    if (input.dryRun) return { ok: true, imported: 0, preview }

    await txn(async () => {
      for (const bill of bills) {
        const vendor = vendorByCode.get(bill.vendorCode)!
        const result = await saveBill({
          billDate: bill.date,
          billNo: bill.billNo,
          vendor: { kind: 'existing', id: vendor.id },
          lines: bill.rows.map((row) => ({ item: { kind: 'existing' as const, id: itemByCode.get(row.itemCode)!.id }, qty: row.qty, rate: row.rate, expiryDate: row.expiry })),
          gstTotal: bill.gst,
          transport: bill.transport,
        })
        if (!result.ok) throw new Error(`Bill ${bill.billNo}: ${result.error}`)
      }
    })
    return { ok: true, imported: bills.length }
  } catch (error) {
    return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? `${error.message} — nothing was written` : 'Purchase batch import failed — nothing was written' }
  }
}

export const purchaseBatchImportContract = async () => 'CSV columns: bill_date,bill_no,vendor_code,gst_total,transport,item_code,qty,rate,expiry_date. Group lines by bill_no; every row repeats that bill’s metadata. Preview validates vendors, items, duplicate references, line limits, and totals without writing. Commit writes every bill through the normal stock, dues, tax, lot, and journal path in one transaction.'
