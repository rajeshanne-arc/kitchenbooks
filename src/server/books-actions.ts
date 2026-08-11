'use server'

// Write side of Books. Three kinds of writes, all as the kb_app role:
//  - voidBill: ONE transaction inserting a reversal purchase (negative copy,
//    reverses_id set) plus negative lines. Purchases are never updated —
//    the role has no UPDATE grant on events, the database would refuse.
//  - recordPayment: single INSERT into payments.
//  - updateVendor / updateItem: UPDATE restricted to exactly the columns the
//    role holds column-level grants for. code / category / purchase_unit are
//    locked at the database and never appear in a SET here.
// Every result is read back from the database (bills, vendor_dues) after the
// write — nothing shown to the user is an echo of what they typed.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { enteredBy } from '@/server/current-user'
import { getBill, getDues, getItemDetail, getVendorDetail } from '@/server/books-queries'
import { parseMoney, paiseToString } from '@/lib/money'
import type {
  CreateItemInput,
  CreateItemResult,
  CreateVendorInput,
  CreateVendorResult,
  PaymentInput,
  PaymentResult,
  UpdateItemInput,
  UpdateItemResult,
  UpdateVendorInput,
  UpdateVendorResult,
  VoidBillResult,
} from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

class BooksError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof BooksError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('books action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

function assertRealDate(s: string, label: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new BooksError(`${label} is not a real calendar date`)
  }
  const year = Number(s.slice(0, 4))
  if (year < 2000 || year > 2100) throw new BooksError(`${label} is out of range`)
}

// ---------------------------------------------------------------- void bill

export async function voidBill(purchaseId: string): Promise<VoidBillResult> {
  try {
    if (!UUID.test(purchaseId)) throw new BooksError('Malformed bill id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const before = await sql<{ balance: string }[]>`
      select coalesce(d.balance, 0)::text as balance
      from purchases p
      left join vendor_dues d on d.vendor_id = p.vendor_id
      where p.id = ${purchaseId}`
    const duesBefore = before[0]?.balance ?? null

    const by = await enteredBy()
    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [orig] = await tx<
        { id: string; vendor_id: string; bill_no: string | null; reverses_id: string | null }[]
      >`
        select id, vendor_id, bill_no, reverses_id
        from purchases where id = ${purchaseId} and restaurant_id = ${rid}`
      if (!orig) throw new BooksError('Bill not found')
      if (orig.reverses_id !== null) throw new BooksError('This is a reversal bill — reversals cannot be voided')
      const already = await tx<{ id: string }[]>`select id from purchases where reverses_id = ${purchaseId} limit 1`
      if (already[0]) throw new BooksError('This bill is already voided')
      const [{ n: lineCount }] = await tx<{ n: number }[]>`
        select count(*)::int as n from purchase_lines where purchase_id = ${purchaseId}`

      const revBillNo = orig.bill_no ? `${orig.bill_no}-VOID` : `VOID-${orig.id.slice(0, 8)}`
      const [rev] = await tx<{ id: string }[]>`
        insert into purchases (restaurant_id, bill_date, vendor_id, bill_no, goods_total, gst_total, transport, reverses_id, entered_by)
        select restaurant_id, bill_date, vendor_id, ${revBillNo}, -goods_total, -gst_total, -transport, id, ${by}
        from purchases where id = ${purchaseId}
        returning id`
      await tx`
        insert into purchase_lines (purchase_id, item_id, qty, rate, gst_amount, transport_alloc)
        select ${rev.id}, item_id, -qty, rate, -gst_amount, -transport_alloc
        from purchase_lines where purchase_id = ${purchaseId}`
      return { revId: rev.id, vendorId: orig.vendor_id, expectedLines: lineCount }
    })

    // Post-commit verification straight from the views/events.
    const [check] = await sql<{ zeroed: boolean; orig_voided: boolean; rev_lines: number }[]>`
      select (ob.bill_total + rb.bill_total = 0) as zeroed,
             ob.is_voided as orig_voided,
             (select count(*)::int from purchase_lines where purchase_id = ${saved.revId}) as rev_lines
      from bills ob, bills rb
      where ob.id = ${purchaseId} and rb.id = ${saved.revId}`
    if (!check) throw new BooksError('Verification failed: rows missing after commit')
    if (!check.orig_voided) throw new BooksError('Verification failed: original is not marked voided')
    if (!check.zeroed) throw new BooksError('Verification failed: totals do not cancel to zero')
    if (check.rev_lines !== saved.expectedLines) {
      throw new BooksError(`Verification failed: expected ${saved.expectedLines} reversal lines, found ${check.rev_lines}`)
    }

    const [original, reversal, dues] = await Promise.all([
      getBill(rid, purchaseId),
      getBill(rid, saved.revId),
      getDues(saved.vendorId),
    ])
    if (!original || !reversal) throw new BooksError('Verification failed: could not read bills back')
    return { ok: true, original, reversal, dues, duesBefore }
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------------------ record payment

const PaymentSchema = z.object({
  vendorId: z.string().regex(UUID),
  paidDate: z.string().regex(DATE_RE),
  amount: z.string().regex(/^\d{1,5}(\.\d{1,2})?$/, 'plain amount, up to 2 decimals'),
  mode: z.string().trim().max(30),
  note: z.string().trim().max(300),
})

export async function recordPayment(raw: PaymentInput): Promise<PaymentResult> {
  try {
    const input = PaymentSchema.parse(raw)
    assertRealDate(input.paidDate, 'Payment date')
    const amountPaise = parseMoney(input.amount)
    if (amountPaise === null || amountPaise <= 0) throw new BooksError('Amount must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const vendor = await sql<{ id: string }[]>`
      select id from vendors where id = ${input.vendorId} and restaurant_id = ${rid}`
    if (!vendor[0]) throw new BooksError('Vendor not found')

    const duesBefore = (await getDues(input.vendorId)).balance

    const [payment] = await sql<
      { id: string; paid_date: string; amount: string; mode: string | null; note: string | null; created_at: string }[]
    >`
      insert into payments (restaurant_id, paid_date, vendor_id, amount, mode, note, entered_by)
      values (${rid}, ${input.paidDate}, ${input.vendorId}, ${paiseToString(amountPaise)}::numeric,
              ${input.mode === '' ? null : input.mode}, ${input.note === '' ? null : input.note}, ${await enteredBy()})
      returning id, paid_date::text as paid_date, amount::text as amount, mode, note, created_at::text as created_at`
    if (!payment) throw new BooksError('Payment insert could not be verified')

    const dues = await getDues(input.vendorId)
    return { ok: true, payment, dues, duesBefore }
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------------------- edit masters

const trimmedOrNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

// Every column kb_app may UPDATE on vendors. code and primary_category are
// deliberately absent: the database refuses them, so the form shows them
// locked rather than offering an edit that would fail at the grant.
// opening_balance is signed — a vendor can be owed money or hold an advance.
const VendorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  gstin: z.string().trim().max(20),
  phone: z.string().trim().max(20),
  paymentTerms: z.string().trim().max(120),
  supplies: z.array(z.string().trim().min(1).max(60)).max(30),
  status: z.enum(['active', 'inactive']),
  contactPerson: z.string().trim().max(120),
  altPhone: z.string().trim().max(20),
  email: z.string().trim().max(160),
  address: z.string().trim().max(400),
  bankName: z.string().trim().max(120),
  accountNo: z.string().trim().max(40),
  ifsc: z.string().trim().max(20),
  upiId: z.string().trim().max(80),
  natureOfSupply: z.string().trim().max(80),
  openingBalance: z.union([z.literal(''), z.string().regex(/^-?\d{1,9}(\.\d{1,2})?$/)]),
  notes: z.string().trim().max(2000),
})

export async function updateVendor(id: string, raw: UpdateVendorInput): Promise<UpdateVendorResult> {
  try {
    if (!UUID.test(id)) throw new BooksError('Malformed vendor id')
    const input = VendorSchema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const supplies = [...new Set(input.supplies.map((s) => s.trim()).filter(Boolean))]

    if (input.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      throw new BooksError('That email address does not look right')
    }
    if (input.ifsc !== '' && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(input.ifsc)) {
      throw new BooksError('An IFSC is 4 letters, a zero, then 6 characters — e.g. HDFC0001234')
    }

    // Only the column-granted fields ever appear in this SET.
    const updated = await sql<{ id: string }[]>`
      update vendors set
        name = ${input.name},
        gstin = ${trimmedOrNull(input.gstin)},
        phone = ${trimmedOrNull(input.phone)},
        payment_terms = ${trimmedOrNull(input.paymentTerms)},
        supplies = ${supplies},
        status = ${input.status},
        contact_person = ${trimmedOrNull(input.contactPerson)},
        alt_phone = ${trimmedOrNull(input.altPhone)},
        email = ${trimmedOrNull(input.email)},
        address = ${trimmedOrNull(input.address)},
        bank_name = ${trimmedOrNull(input.bankName)},
        account_no = ${trimmedOrNull(input.accountNo)},
        ifsc = ${input.ifsc.trim() === '' ? null : input.ifsc.trim().toUpperCase()},
        upi_id = ${trimmedOrNull(input.upiId)},
        nature_of_supply = ${trimmedOrNull(input.natureOfSupply)},
        opening_balance = ${input.openingBalance === '' ? '0' : input.openingBalance}::numeric,
        notes = ${trimmedOrNull(input.notes)}
      where id = ${id} and restaurant_id = ${rid}
      returning id`
    if (!updated[0]) throw new BooksError('Vendor not found — nothing was changed')

    const vendor = await getVendorDetail(rid, id)
    if (!vendor) throw new BooksError('Could not read the vendor back after saving')
    return { ok: true, vendor }
  } catch (e) {
    return fail(e)
  }
}

const numStr = (maxDp: number, re = `^\\d{1,5}(\\.\\d{1,${maxDp}})?$`) => z.string().regex(new RegExp(re))

// Every column kb_app may UPDATE on items EXCEPT yield_pct, which stays out
// of the UI by rule: recipes state gross quantities, so trim yield lives in
// the recipe and an item-level yield field must not come back.
// code, category and purchase_unit have no grant — shown locked.
const ItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80),
  gstRate: z.union([z.literal(''), numStr(2)]),
  parLevel: z.union([z.literal(''), numStr(3)]),
  conversionFactor: numStr(4),
  stockUnit: z.string().trim().max(16),
  openingRate: z.union([z.literal(''), numStr(2)]),
  status: z.enum(['active', 'inactive']),
  reorderLevel: z.union([z.literal(''), numStr(3)]),
  defaultVendorId: z.union([z.literal(''), z.string().regex(UUID)]),
  itemType: z.string().trim().max(40),
  notes: z.string().trim().max(2000),
})

export async function updateItem(id: string, raw: UpdateItemInput): Promise<UpdateItemResult> {
  try {
    if (!UUID.test(id)) throw new BooksError('Malformed item id')
    const input = ItemSchema.parse(raw)

    const convNum = Number(input.conversionFactor)
    if (!(convNum > 0)) throw new BooksError('Conversion factor must be more than zero')
    if (input.gstRate !== '' && Number(input.gstRate) > 100) throw new BooksError('GST rate is a percentage — 100 max')

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    if (input.stockUnit !== '') {
      const unit = await sql<{ code: string }[]>`select code from units where code = ${input.stockUnit}`
      if (!unit[0]) throw new BooksError(`Unknown unit “${input.stockUnit}”`)
    }

    if (input.defaultVendorId !== '') {
      const v = await sql<{ id: string }[]>`
        select id from vendors where id = ${input.defaultVendorId} and restaurant_id = ${rid}`
      if (!v[0]) throw new BooksError('That vendor does not belong to this restaurant')
    }

    // Only the column-granted fields ever appear in this SET.
    const updated = await sql<{ id: string }[]>`
      update items set
        name = ${input.name},
        brand = ${trimmedOrNull(input.brand)},
        gst_rate = ${input.gstRate === '' ? null : input.gstRate}::numeric,
        par_level = ${input.parLevel === '' ? null : input.parLevel}::numeric,
        conversion_factor = ${input.conversionFactor}::numeric,
        stock_unit = ${input.stockUnit === '' ? null : input.stockUnit},
        opening_rate = ${input.openingRate === '' ? null : input.openingRate}::numeric,
        status = ${input.status},
        reorder_level = ${input.reorderLevel === '' ? null : input.reorderLevel}::numeric,
        default_vendor_id = ${input.defaultVendorId === '' ? null : input.defaultVendorId},
        item_type = ${trimmedOrNull(input.itemType)},
        notes = ${trimmedOrNull(input.notes)}
      where id = ${id} and restaurant_id = ${rid}
      returning id`
    if (!updated[0]) throw new BooksError('Item not found — nothing was changed')

    const item = await getItemDetail(rid, id)
    if (!item) throw new BooksError('Could not read the item back after saving')
    return { ok: true, item }
  } catch (e) {
    return fail(e)
  }
}

// ----------------------------------------------------- create masters
// Standalone birth (phase 14): vendors and items can now be created ahead
// of their first bill. Same code series, same transaction discipline as
// the inline path in save-bill — V-<CAT>-NN and <CAT>-NNN never fork.

const CreateVendorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().min(1).max(16),
  gstin: z.string().trim().max(20),
  phone: z.string().trim().max(20),
  paymentTerms: z.string().trim().max(120),
})

export async function createVendor(raw: CreateVendorInput): Promise<CreateVendorResult> {
  try {
    const input = CreateVendorSchema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const cat = await sql<{ code: string }[]>`
      select code from categories where code = ${input.category} and status = 'active'`
    if (!cat[0]) throw new BooksError(`Unknown category “${input.category}”`)

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [dup] = await tx<{ code: string }[]>`
        select code from vendors
        where restaurant_id = ${rid} and lower(name) = lower(${input.name}) limit 1`
      if (dup) throw new BooksError(`A vendor with this name already exists (${dup.code}) — open it instead`)
      const [{ next }] = await tx<{ next: number }[]>`
        select coalesce(max(nullif(split_part(code, '-', 3), '')::int), 0) + 1 as next
        from vendors
        where restaurant_id = ${rid} and code like ${'V-' + input.category + '-%'}`
      const vcode = `V-${input.category}-${String(next).padStart(2, '0')}`
      const [v] = await tx<{ id: string }[]>`
        insert into vendors (restaurant_id, code, name, primary_category, gstin, phone, payment_terms)
        values (${rid}, ${vcode}, ${input.name}, ${input.category},
                ${trimmedOrNull(input.gstin)}, ${trimmedOrNull(input.phone)}, ${trimmedOrNull(input.paymentTerms)})
        returning id`
      return { id: v.id }
    })

    const vendor = await getVendorDetail(rid, saved.id)
    if (!vendor) throw new BooksError('Could not read the vendor back after saving')
    return { ok: true, vendor }
  } catch (e) {
    return fail(e)
  }
}

const CreateItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().min(1).max(16),
  purchaseUnit: z.string().min(1).max(16),
  openingRate: z.union([z.literal(''), z.string().regex(/^\d{1,5}(\.\d{1,2})?$/)]),
  brand: z.string().trim().max(80),
})

export async function createItem(raw: CreateItemInput): Promise<CreateItemResult> {
  try {
    const input = CreateItemSchema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const cat = await sql<{ code: string }[]>`
      select code from categories where code = ${input.category} and status = 'active'`
    if (!cat[0]) throw new BooksError(`Unknown category “${input.category}”`)
    const unit = await sql<{ code: string }[]>`select code from units where code = ${input.purchaseUnit}`
    if (!unit[0]) throw new BooksError(`Unknown unit “${input.purchaseUnit}”`)

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [dup] = await tx<{ code: string }[]>`
        select code from items
        where restaurant_id = ${rid} and lower(name) = lower(${input.name}) limit 1`
      if (dup) throw new BooksError(`An item with this name already exists (${dup.code}) — open it instead`)
      const [{ n }] = await tx<{ n: number }[]>`
        select coalesce(max(nullif(split_part(code, '-', 2), '')::int), 0) as n
        from items
        where restaurant_id = ${rid} and code like ${input.category + '-%'}`
      const icode = `${input.category}-${String(n + 1).padStart(3, '0')}`
      const [row] = await tx<{ id: string }[]>`
        insert into items (restaurant_id, code, name, category, purchase_unit, opening_rate, brand)
        values (${rid}, ${icode}, ${input.name}, ${input.category}, ${input.purchaseUnit},
                ${input.openingRate === '' ? null : input.openingRate}::numeric, ${trimmedOrNull(input.brand)})
        returning id`
      return { id: row.id }
    })

    const item = await getItemDetail(rid, saved.id)
    if (!item) throw new BooksError('Could not read the item back after saving')
    return { ok: true, item }
  } catch (e) {
    return fail(e)
  }
}
