// Phase-2 smoke: drives the exact DoD sequence through the real server
// modules against the live DB — bill -> books -> payment (dues fall exactly)
// -> void (dues go negative, payment-only) -> item yield edit persists.
// Creates only "Zz Books …" rows and prints their ids for cleanup (the app
// role cannot DELETE; clean up as postgres via MCP). Never touches real data.
//
// Run: npm run smoke:books
import assert from 'node:assert/strict'
import { ensureSmokeAccount } from './smoke-account'

process.loadEnvFile('.env.local')

// Money forms now refuse a blank account. Smokes resolve a real one at
// runtime; see ensureSmokeAccount below.
let ACCOUNT = ''

async function main() {
  const { saveBill } = await import('../src/server/save-bill')
  const { getRestaurant, searchItems } = await import('../src/server/queries')
  const { recordPayment, updateItem, updateVendor, voidBill } = await import('../src/server/books-actions')
  const { getBill, getItemDetail, getVendorBills, listBills } = await import('../src/server/books-queries')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  console.log('restaurant:', restaurant.name)
  ACCOUNT = await ensureSmokeAccount(restaurant.id)

  const before = (await sql`
    select (select count(*)::int from vendors) as vendors,
           (select count(*)::int from items) as items,
           (select count(*)::int from purchases) as purchases,
           (select count(*)::int from payments) as payments`) as unknown as Record<string, number>[]
  console.log('counts before:', JSON.stringify(before[0]))

  // -- 1. enter a bill (new vendor + starter item): 10 × 40 + gst 20 + transport 30 = 450
  const tomatoHits = await searchItems(restaurant.id, 'tomato')
  const starter = tomatoHits.find((h) => h.kind === 'starter')
  assert.ok(starter && starter.kind === 'starter', 'starter tomato must be available')
  const bill = await saveBill({
    billDate: '2026-08-09',
    vendor: { kind: 'new', name: 'Zz Books Traders', category: 'VEG' },
    lines: [{ item: { kind: 'starter', starterId: starter.starter_id, unit: starter.purchase_unit }, qty: '10', rate: '40' }],
    gstTotal: '20',
    transport: '30',
  })
  assert.ok(bill.ok, `saveBill failed: ${bill.ok === false ? bill.error : ''}`)
  assert.equal(bill.purchase.billTotal, '450')
  assert.equal(bill.dues.balance, '450')
  const vendorId = bill.vendor.id
  const itemId = bill.createdItems[0].id
  const purchaseId = bill.purchase.id

  // -- 2. it shows in Books
  const inBooks = (await listBills(restaurant.id)).find((b) => b.id === purchaseId)
  assert.ok(inBooks, 'bill must appear in the bills view')
  assert.equal(inBooks.is_voided, false)
  assert.equal(inBooks.is_reversal, false)
  assert.equal(inBooks.line_count, 1)

  // -- 3. record a part payment of 150 -> dues fall exactly to 300
  const pay = await recordPayment({ vendorId, paidDate: '2026-08-09', amount: '150', mode: 'UPI', note: 'zz books smoke', accountId: ACCOUNT })
  assert.ok(pay.ok, `recordPayment failed: ${pay.ok === false ? pay.error : ''}`)
  assert.equal(pay.duesBefore, '450')
  assert.equal(pay.dues.balance, '300')
  assert.equal(pay.payment.amount, '150')

  // -- 4. void the bill -> dues fall to payment-only balance: -150
  const voided = await voidBill(purchaseId)
  assert.ok(voided.ok, `voidBill failed: ${voided.ok === false ? voided.error : ''}`)
  assert.equal(voided.original.is_voided, true)
  assert.equal(voided.reversal.is_reversal, true)
  assert.equal(voided.reversal.bill_total, '-450')
  assert.equal(voided.reversal.bill_no, `VOID-${purchaseId.slice(0, 8)}`)
  assert.equal(voided.duesBefore, '300')
  assert.equal(voided.dues.balance, '-150')

  // reversal guards
  const again = await voidBill(purchaseId)
  assert.ok(!again.ok && /already voided/i.test(again.error), 'double void must be refused')
  const revVoid = await voidBill(voided.reversal.id)
  assert.ok(!revVoid.ok && /reversal/i.test(revVoid.error), 'voiding a reversal must be refused')

  // both bills in vendor history, netting to zero
  const vbills = await getVendorBills(restaurant.id, vendorId)
  assert.equal(vbills.length, 2)
  const readBack = await getBill(restaurant.id, voided.reversal.id)
  assert.ok(readBack && readBack.reverses_id === purchaseId, 'reversal must point at the original')

  // -- 5. edit item yield to 70 and see it persist
  const item = await getItemDetail(restaurant.id, itemId)
  assert.ok(item, 'item detail must load')
  const upd = await updateItem(itemId, {
    name: item.name,
    brand: 'Zz Farm',
    gstRate: '',
    parLevel: '5',
    conversionFactor: item.conversion_factor,
    stockUnit: item.stock_unit ?? '',
    openingRate: '',
    status: 'active',
    reorderLevel: '',
    defaultVendorId: '',
    itemType: '',
    notes: '',
  })
  assert.ok(upd.ok, `updateItem failed: ${upd.ok === false ? upd.error : ''}`)
  const persisted = await getItemDetail(restaurant.id, itemId)
  assert.equal(persisted?.par_level, '5')
  assert.equal(persisted?.brand, 'Zz Farm')

  // -- 6. vendor edit round-trip (granted columns only)
  const vupd = await updateVendor(vendorId, {
    name: 'Zz Books Traders',
    gstin: '',
    phone: '9000000000',
    paymentTerms: '15 days credit',
    supplies: ['Tomatoes', 'Greens'],
    status: 'active',
    contactPerson: '',
    altPhone: '',
    email: '',
    address: '',
    bankName: '',
    accountNo: '',
    ifsc: '',
    upiId: '',
    natureOfSupply: '',
    openingBalance: '',
    notes: '',
  })
  assert.ok(vupd.ok, `updateVendor failed: ${vupd.ok === false ? vupd.error : ''}`)
  assert.equal(vupd.vendor.phone, '9000000000')
  assert.deepEqual(vupd.vendor.supplies, ['Tomatoes', 'Greens'])

  console.log('ALL BOOKS SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        purchases: [purchaseId, voided.reversal.id],
        payment: pay.payment.id,
        item: itemId,
        vendor: vendorId,
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('BOOKS SMOKE FAILED:', e)
  process.exit(1)
})
