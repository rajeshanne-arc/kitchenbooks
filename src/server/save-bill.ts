'use server'

// The single write path. One purchase = ONE database transaction that inserts
// the vendor (if new), any new items, the purchase, and its lines together —
// or nothing at all. Inserts only: the kb_app role physically cannot UPDATE
// or DELETE, and corrections are reversal rows by design (out of scope here).
// After commit, every number returned to the screen is read back from the
// database (purchases row + vendor_dues view), never echoed from the client.

import { z } from 'zod'
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { createPurchaseLots } from '@/server/lot-ledger'
import { enteredBy } from '@/server/current-user'
import { nextDocNo } from '@/server/doc-numbers'
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
import { postJournalEntryTx } from '@/server/journal'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const moneyStr = z.string().regex(/^\d{1,5}(\.\d{1,2})?$/, 'must be a plain amount with up to 2 decimals')
const qtyStr = z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'must be a plain quantity with up to 3 decimals')
const codeStr = z.string().min(1).max(16)
const nameStr = z.string().trim().min(1).max(120)

const Input = z.object({
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billNo: z.string().trim().max(120).optional(),
  /** THE ORDER THIS BILL FULFILS, if it fulfils one.
   *
   *  Optional, and it must stay optional: a delivery can arrive against no
   *  order at all — that is how every bill in this app was entered before
   *  purchase orders existed, and how a market run still arrives. What a PO
   *  adds is a comparison, and `po_fulfilment` only counts bills that cite
   *  one, so a bill without it is not wrong, it is merely uncompared. */
  purchaseOrderId: z.union([z.literal(''), z.string().regex(UUID)]).optional(),
  vendor: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('existing'), id: z.string().regex(UUID) }),
    z.object({ kind: z.literal('new'), name: nameStr, category: codeStr }),
  ]),
  lines: z
    .array(
      z.object({
        /** Required ONLY where the item carries a printed date — checked
         *  against items.tracks_expiry inside the transaction, because a form
         *  is never the check and an item's flag can change between the
         *  screen loading and the save. */
        expiryDate: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
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
      const found = await tsql<{ code: string }[]>`
        select code from categories where code = any(${[...catCodes]}) and status = 'active'`
      for (const c of catCodes) if (!found.some((f) => f.code === c)) throw new BillError(`Unknown category “${c}”`)
    }
    if (unitCodes.size > 0) {
      const found = await tsql<{ code: string }[]>`select code from units where code = any(${[...unitCodes]})`
      for (const u of unitCodes) if (!found.some((f) => f.code === u)) throw new BillError(`Unknown unit “${u}”`)
    }

    const by = await enteredBy()
    const saved = await txn(async (tx) => {
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

      // On the bill date, not today: a March bill entered in April belongs to
      // March's financial year. Inside the tx so a failed save burns no number.
      const docNo = await nextDocNo(tx, rid, 'PUR', input.billDate)

      // THE ORDER IS CHECKED, NOT TRUSTED: it must belong to this restaurant,
      // to THIS vendor, and be one that goods could arrive against. A bill
      // citing another vendor's order would put a delivery against a document
      // nobody sent them, and po_fulfilment would report the gap as theirs.
      const poId = input.purchaseOrderId === undefined || input.purchaseOrderId === ''
        ? null
        : input.purchaseOrderId
      if (poId !== null) {
        const [po] = await tx<{ id: string; status: string; vendor_id: string }[]>`
          select id, status, vendor_id from purchase_orders
          where id = ${poId} and restaurant_id = ${rid}
          for update`
        if (!po) throw new BillError('That purchase order does not exist')
        if (po.vendor_id !== vendorId) {
          throw new BillError('That purchase order was raised for a different vendor')
        }
        if (po.status === 'draft') {
          throw new BillError('That order has not been sent yet — nothing can have arrived against it')
        }
        if (po.status === 'cancelled') throw new BillError('That order was cancelled')
      }

      const [purchase] = await tx<{ id: string }[]>`
        insert into purchases (restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, entered_by, doc_no, purchase_order_id)
        values (${rid}, ${input.billDate}, ${vendorId},
                ${input.billNo ?? null},
                ${goodsTotal}::numeric, ${paiseToString(gstPaise)}::numeric, ${paiseToString(transportPaise)}::numeric,
                ${by}, ${docNo}, ${poId})
        returning id`

      const mappings = await tx<{ mapping_key: string; account_id: string; account_type: string }[]>`
        select m.mapping_key, m.account_id, a.account_type
        from accounting_posting_mappings m
        join accounting_accounts a on a.restaurant_id = m.restaurant_id and a.id = m.account_id
        where m.restaurant_id = ${rid}
          and m.mapping_key = any(${['inventory_asset', 'input_tax_asset', 'vendor_payable']})
          and a.status = 'active'`
      const mapping = new Map(mappings.map((row) => [row.mapping_key, row]))
      if (!mapping.get('inventory_asset') || mapping.get('inventory_asset')?.account_type !== 'asset') {
        throw new BillError('Configure an asset ledger account for inventory before recording a purchase')
      }
      if (!mapping.get('vendor_payable') || mapping.get('vendor_payable')?.account_type !== 'liability') {
        throw new BillError('Configure the vendor-payable liability mapping before recording a purchase')
      }

      // A DELIVERY MOVES THE ORDER ON, the way an issue flips an indent. Only
      // sent → received: a part-delivered order stays where it is, and only a
      // person closes it, because only a person knows nothing more is coming.
      if (poId !== null) {
        await tx`update purchase_orders set status = 'received'
                 where id = ${poId} and restaurant_id = ${rid} and status = 'sent'`
      }

      // REQUIRED ONLY WHERE THE ITEM TRACKS IT, and checked here rather than
      // on the form: the flag is on the item and can change while a bill is
      // open, and a form is never the check. The refusal names the ITEM,
      // because the receiver is holding a bill with names on it and has no
      // idea which row is "line 3".
      const tracked = await tx<{ id: string; name: string }[]>`
        select id, name from items
        where restaurant_id = ${rid} and tracks_expiry = true
          and id = any(${itemIds}::uuid[])`
      const tracks = new Map(tracked.map((t) => [t.id, t.name]))
      for (const [i, l] of input.lines.entries()) {
        const name = tracks.get(itemIds[i])
        if (name !== undefined && (l.expiryDate === undefined || l.expiryDate === '')) {
          throw new BillError(`${name} carries a printed expiry date — enter it from the pack`)
        }
      }

      const lineRows = input.lines.map((l, i) => ({
        restaurant_id: rid,
        purchase_id: purchase.id,
        item_id: itemIds[i],
        qty: l.qty.trim(),
        rate: l.rate.trim(),
        gst_amount: '0',
        transport_alloc: paiseToString(transportAlloc[i]),
        expiry_date: l.expiryDate === undefined || l.expiryDate === '' ? null : l.expiryDate,
      }))
      await tx`insert into purchase_lines ${tx(lineRows, 'restaurant_id', 'purchase_id', 'item_id', 'qty', 'rate', 'gst_amount', 'transport_alloc', 'expiry_date')}`
      await createPurchaseLots(tx, rid, purchase.id, by)

      // ASSESS, DO NOT ALTER, the invoice against its cited order. This is an
      // evidence row: the bill remains immutable and later review can see
      // exactly what was compared when it was received.
      const [match] = await tx<{ status: 'unmatched' | 'matched' | 'partial' | 'exception'; quantity_exception: boolean; price_exception: boolean; snapshot: unknown }[]>`
        with ordered as (
          select l.item_id, l.qty::numeric as ordered_qty, l.rate::numeric as ordered_rate
          from purchase_order_lines l
          where l.restaurant_id = ${rid} and l.purchase_order_id = ${poId}::uuid
        ), delivered as (
          select pl.item_id, sum(pl.qty)::numeric as delivered_qty,
                 bool_or(o.item_id is not null and pl.rate::numeric <> o.ordered_rate) as price_exception
          from purchase_lines pl
          join purchases p on p.restaurant_id = pl.restaurant_id and p.id = pl.purchase_id
          left join ordered o on o.item_id = pl.item_id
          where pl.restaurant_id = ${rid} and p.purchase_order_id = ${poId}::uuid
          group by pl.item_id
        ), comparison as (
          select o.item_id, o.ordered_qty, o.ordered_rate,
                 coalesce(d.delivered_qty, 0)::numeric as delivered_qty,
                 coalesce(d.price_exception, false) as price_exception,
                 false as unlisted
          from ordered o left join delivered d on d.item_id = o.item_id
          union all
          select d.item_id, 0, null, d.delivered_qty, coalesce(d.price_exception, false), true
          from delivered d left join ordered o on o.item_id = d.item_id
          where o.item_id is null
        ), flags as (
          select coalesce(bool_or(delivered_qty > ordered_qty or unlisted), false) as quantity_exception,
                 coalesce(bool_or(price_exception), false) as price_exception,
                 coalesce(bool_and(delivered_qty = ordered_qty and not unlisted), false) as all_received,
                 coalesce(bool_or(delivered_qty < ordered_qty), false) as has_short
          from comparison
        )
        select case when ${poId}::uuid is null then 'unmatched'::text
                    when quantity_exception or price_exception then 'exception'::text
                    when all_received then 'matched'::text
                    when has_short then 'partial'::text
                    else 'exception'::text end as status,
               quantity_exception, price_exception,
               jsonb_build_object('purchase_order_id', ${poId}::uuid, 'lines', coalesce((select jsonb_agg(to_jsonb(comparison)) from comparison), '[]'::jsonb)) as snapshot
        from flags`
      if (!match) throw new BillError('Could not assess the purchase against its order')
      const matchSnapshot = typeof match.snapshot === 'string' ? match.snapshot : JSON.stringify(match.snapshot)
      await tx`
        insert into purchase_invoice_matches
          (restaurant_id, purchase_id, purchase_order_id, status, quantity_exception, price_exception, snapshot, assessed_by)
        values (${rid}, ${purchase.id}, ${poId}, ${match.status}, ${match.quantity_exception}, ${match.price_exception}, ${matchSnapshot}::jsonb, ${by})`

      const [taxSetting] = await tx<{ creditable: boolean }[]>`
        select coalesce((select value = 'true' from settings
                         where restaurant_id = ${rid} and key = 'input_tax_creditable'), false) as creditable`
      const [totals] = await tx<{ goods: string; gst: string; transport: string; total: string }[]>`
        select goods_total::text as goods, gst_total::text as gst,
               transport::text as transport, bill_total::text as total
        from purchases where id = ${purchase.id} and restaurant_id = ${rid}`
      if (!totals) throw new BillError('Could not read the purchase totals before journal posting')
      const journalLines = [] as { accountId: string; debit?: string; credit?: string; description: string }[]
      if (taxSetting.creditable && Number(totals.gst) > 0) {
        const tax = mapping.get('input_tax_asset')
        if (!tax || tax.account_type !== 'asset') throw new BillError('Input tax is marked creditable, so configure its asset ledger mapping')
        journalLines.push({ accountId: mapping.get('inventory_asset')!.account_id, debit: (Number(totals.goods) + Number(totals.transport)).toFixed(2), description: 'Inventory and transport' })
        journalLines.push({ accountId: tax.account_id, debit: totals.gst, description: 'Input tax' })
      } else {
        journalLines.push({ accountId: mapping.get('inventory_asset')!.account_id, debit: totals.total, description: 'Inventory purchase' })
      }
      journalLines.push({ accountId: mapping.get('vendor_payable')!.account_id, credit: totals.total, description: 'Vendor payable' })
      await postJournalEntryTx(tx, rid, {
        date: input.billDate,
        sourceType: 'purchase',
        sourceId: purchase.id,
        memo: `Purchase ${docNo}`,
        postedBy: by ?? undefined,
        lines: journalLines,
      })

      return { purchaseId: purchase.id, vendorId, vendorCreated, createdItems }
    })

    // Post-commit verification: the numbers shown on screen are the ones the
    // database now holds, and the stored pieces reconcile exactly.
    const [check] = await tsql<
      {
        doc_no: string | null
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
      select p.doc_no, p.bill_date::text as bill_date,
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

    const [vendor] = await tsql<{ code: string; name: string; balance: string; purchased: string; paid: string }[]>`
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
        docNo: check.doc_no,
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
