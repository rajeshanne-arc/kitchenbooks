'use server'

// The single write path. One purchase = ONE database transaction that inserts
// the vendor (if new), any new items, the purchase, and its lines together —
// or nothing at all. Inserts only: the kb_app role physically cannot UPDATE
// or DELETE, and corrections are reversal rows by design (out of scope here).
// After commit, every number returned to the screen is read back from the
// database (purchases row + vendor_dues view), never echoed from the client.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import {
  allocateTransport,
  lineValueMicro,
  microToString,
  paiseToString,
  parseMoney,
  parseQty,
  sumMicro,
} from '@/lib/money'
import type { SaveBillInput, SaveBillResult } from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const moneyStr = z.string().regex(/^\d{1,5}(\.\d{1,2})?$/, 'must be a plain amount with up to 2 decimals')
const qtyStr = z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'must be a plain quantity with up to 3 decimals')
const codeStr = z.string().min(1).max(16)
const nameStr = z.string().trim().min(1).max(120)

const Input = z.object({
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vendor: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('existing'), id: z.string().regex(UUID) }),
    z.object({ kind: z.literal('new'), name: nameStr, category: codeStr }),
  ]),
  lines: z
    .array(
      z.object({
        item: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('existing'), id: z.string().regex(UUID) }),
          z.object({ kind: z.literal('starter'), starterId: z.number().int().positive(), unit: codeStr }),
          z.object({ kind: z.literal('new'), name: nameStr, category: codeStr, unit: codeStr }),
        ]),
        qty: qtyStr,
        rate: moneyStr,
      }),
    )
    .min(1)
    .max(40),
  gstTotal: moneyStr,
  transport: moneyStr,
})

class BillError extends Error {}

function assertRealDate(s: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new BillError(`“${s}” is not a real calendar date`)
  }
  const year = Number(s.slice(0, 4))
  if (year < 2000 || year > 2100) throw new BillError('Bill date is out of range')
}

export async function saveBill(rawInput: SaveBillInput): Promise<SaveBillResult> {
  try {
    const input = Input.parse(rawInput)
    assertRealDate(input.billDate)

    const qtyMilli = input.lines.map((l, i) => {
      const v = parseQty(l.qty)
      if (v === null || v <= 0) throw new BillError(`Line ${i + 1}: quantity must be more than zero`)
      return v
    })
    const ratePaise = input.lines.map((l, i) => {
      const v = parseMoney(l.rate)
      if (v === null) throw new BillError(`Line ${i + 1}: rate is not a valid amount`)
      return v
    })
    const gstPaise = parseMoney(input.gstTotal)
    const transportPaise = parseMoney(input.transport)
    if (gstPaise === null || transportPaise === null) {
      throw new BillError('GST and transport must be plain amounts')
    }

    const valuesMicro = input.lines.map((_, i) => lineValueMicro(qtyMilli[i], ratePaise[i]))
    const transportAlloc = allocateTransport(valuesMicro, transportPaise)
    const goodsTotal = microToString(sumMicro(valuesMicro))

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    // Friendlier than FK errors: referenced master codes must exist up front.
    const catCodes = new Set<string>()
    const unitCodes = new Set<string>()
    if (input.vendor.kind === 'new') catCodes.add(input.vendor.category)
    for (const l of input.lines) {
      if (l.item.kind === 'new') {
        catCodes.add(l.item.category)
        unitCodes.add(l.item.unit)
      }
      if (l.item.kind === 'starter') unitCodes.add(l.item.unit)
    }
    if (catCodes.size > 0) {
      const found = await sql<{ code: string }[]>`
        select code from categories where code = any(${[...catCodes]}) and status = 'active'`
      for (const c of catCodes) if (!found.some((f) => f.code === c)) throw new BillError(`Unknown category “${c}”`)
    }
    if (unitCodes.size > 0) {
      const found = await sql<{ code: string }[]>`select code from units where code = any(${[...unitCodes]})`
      for (const u of unitCodes) if (!found.some((f) => f.code === u)) throw new BillError(`Unknown unit “${u}”`)
    }

    const saved = await sql.begin(async (tx) => {
      // One writer per restaurant at a time keeps V-CAT-NN / CAT-NNN series race-free.
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      let vendorId: string
      let vendorCreated = false
      if (input.vendor.kind === 'existing') {
        const rows = await tx<{ id: string }[]>`
          select id from vendors
          where id = ${input.vendor.id} and restaurant_id = ${rid} and status = 'active'`
        if (!rows[0]) throw new BillError('That vendor no longer exists — reselect it')
        vendorId = rows[0].id
      } else {
        const cat = input.vendor.category
        const [{ next }] = await tx<{ next: number }[]>`
          select coalesce(max(nullif(split_part(code, '-', 3), '')::int), 0) + 1 as next
          from vendors
          where restaurant_id = ${rid} and code like ${'V-' + cat + '-%'}`
        const vcode = `V-${cat}-${String(next).padStart(2, '0')}`
        const [v] = await tx<{ id: string }[]>`
          insert into vendors (restaurant_id, code, name, primary_category)
          values (${rid}, ${vcode}, ${input.vendor.name}, ${cat})
          returning id`
        vendorId = v.id
        vendorCreated = true
      }

      const seq = new Map<string, number>()
      const createdItems: { id: string; code: string; name: string }[] = []

      const nextItemCode = async (cat: string) => {
        if (!seq.has(cat)) {
          const [{ n }] = await tx<{ n: number }[]>`
            select coalesce(max(nullif(split_part(code, '-', 2), '')::int), 0) as n
            from items
            where restaurant_id = ${rid} and code like ${cat + '-%'}`
          seq.set(cat, n)
        }
        const n = seq.get(cat)! + 1
        seq.set(cat, n)
        return `${cat}-${String(n).padStart(3, '0')}`
      }

      // Masters are born inline: a starter pick or a typed-in item becomes a
      // real items row here, inside the same transaction as the purchase.
      const materializeItem = async (itemName: string, cat: string, unit: string) => {
        const dup = await tx<{ id: string }[]>`
          select id from items
          where restaurant_id = ${rid} and lower(name) = lower(${itemName})
          limit 1`
        if (dup[0]) return dup[0].id
        const icode = await nextItemCode(cat)
        const [row] = await tx<{ id: string; code: string; name: string }[]>`
          insert into items (restaurant_id, code, name, category, purchase_unit)
          values (${rid}, ${icode}, ${itemName}, ${cat}, ${unit})
          returning id, code, name`
        createdItems.push(row)
        return row.id
      }

      const itemIds: string[] = []
      for (const [i, l] of input.lines.entries()) {
        if (l.item.kind === 'existing') {
          const rows = await tx<{ id: string }[]>`
            select id from items
            where id = ${l.item.id} and restaurant_id = ${rid} and status = 'active'`
          if (!rows[0]) throw new BillError(`Line ${i + 1}: that item no longer exists — reselect it`)
          itemIds.push(rows[0].id)
        } else if (l.item.kind === 'starter') {
          const rows = await tx<{ name: string; category: string }[]>`
            select name, category from starter_library where id = ${l.item.starterId}`
          if (!rows[0]) throw new BillError(`Line ${i + 1}: starter suggestion not found`)
          itemIds.push(await materializeItem(rows[0].name, rows[0].category, l.item.unit))
        } else {
          itemIds.push(await materializeItem(l.item.name, l.item.category, l.item.unit))
        }
      }

      const [purchase] = await tx<{ id: string }[]>`
        insert into purchases (restaurant_id, bill_date, vendor_id, goods_total, gst_total, transport)
        values (${rid}, ${input.billDate}, ${vendorId},
                ${goodsTotal}::numeric, ${paiseToString(gstPaise)}::numeric, ${paiseToString(transportPaise)}::numeric)
        returning id`

      const lineRows = input.lines.map((l, i) => ({
        purchase_id: purchase.id,
        item_id: itemIds[i],
        qty: l.qty.trim(),
        rate: l.rate.trim(),
        gst_amount: '0',
        transport_alloc: paiseToString(transportAlloc[i]),
      }))
      await tx`insert into purchase_lines ${tx(lineRows, 'purchase_id', 'item_id', 'qty', 'rate', 'gst_amount', 'transport_alloc')}`

      return { purchaseId: purchase.id, vendorId, vendorCreated, createdItems }
    })

    // Post-commit verification: the numbers shown on screen are the ones the
    // database now holds, and the stored pieces reconcile exactly.
    const [check] = await sql<
      {
        bill_date: string
        goods_total: string
        gst_total: string
        transport: string
        bill_total: string
        line_count: number
        transport_ok: boolean
        goods_ok: boolean
      }[]
    >`
      select p.bill_date::text as bill_date,
             p.goods_total::text as goods_total,
             p.gst_total::text as gst_total,
             p.transport::text as transport,
             p.bill_total::text as bill_total,
             (select count(*)::int from purchase_lines pl where pl.purchase_id = p.id) as line_count,
             (select coalesce(sum(pl.transport_alloc), 0) = p.transport
                from purchase_lines pl where pl.purchase_id = p.id) as transport_ok,
             (select coalesce(sum(pl.amount), 0) = p.goods_total
                from purchase_lines pl where pl.purchase_id = p.id) as goods_ok
      from purchases p
      where p.id = ${saved.purchaseId}`
    if (!check) throw new BillError('Could not verify the save — purchase row missing after commit')
    if (check.line_count !== input.lines.length) {
      throw new BillError(`Verification failed: expected ${input.lines.length} lines, found ${check.line_count}`)
    }
    if (!check.transport_ok) throw new BillError('Verification failed: transport split does not sum to the transport charge')
    if (!check.goods_ok) throw new BillError('Verification failed: stored line amounts do not sum to the goods total')

    const [vendor] = await sql<{ code: string; name: string; balance: string; purchased: string; paid: string }[]>`
      select v.code, v.name,
             coalesce(d.balance, 0)::text as balance,
             coalesce(d.purchased, 0)::text as purchased,
             coalesce(d.paid, 0)::text as paid
      from vendors v
      left join vendor_dues d on d.vendor_id = v.id
      where v.id = ${saved.vendorId}`
    if (!vendor) throw new BillError('Could not read vendor dues back after saving')

    return {
      ok: true,
      purchase: {
        id: saved.purchaseId,
        billDate: check.bill_date,
        goodsTotal: check.goods_total,
        gstTotal: check.gst_total,
        transport: check.transport,
        billTotal: check.bill_total,
        lineCount: check.line_count,
      },
      vendor: { id: saved.vendorId, code: vendor.code, name: vendor.name, created: saved.vendorCreated },
      createdItems: saved.createdItems,
      dues: { balance: vendor.balance, purchased: vendor.purchased, paid: vendor.paid },
    }
  } catch (e) {
    if (e instanceof BillError) return { ok: false, error: e.message }
    if (e instanceof z.ZodError) return { ok: false, error: 'The bill payload was malformed — nothing was saved' }
    console.error('saveBill failed', e)
    const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
    return { ok: false, error: `Save failed — nothing was written. (${detail})` }
  }
}
