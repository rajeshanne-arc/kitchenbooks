// End-to-end smoke test against the real database, driving the exact server
// modules the app uses (saveBill, searchItems, searchVendors). It creates
// clearly-marked "Zz Smoke" rows and prints their ids as JSON on the last
// line so they can be deleted afterwards — the app role itself cannot DELETE.
//
// Run: npm run smoke        (assumes an otherwise-empty events DB for the
//                            V-VEG-01 / DRY-001 code assertions)
import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

async function main() {
  const { saveBill } = await import('../src/server/save-bill')
  const { getRestaurant, searchItems, searchVendors } = await import('../src/server/queries')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  console.log('restaurant:', restaurant.name)

  // starter suggestion for tomato must exist and carry category/unit
  const tomatoHits = await searchItems(restaurant.id, 'tomato')
  const starterTomato = tomatoHits.find((h) => h.kind === 'starter')
  assert.ok(starterTomato && starterTomato.kind === 'starter', 'expected a starter-library hit for "tomato"')
  console.log('starter tomato:', starterTomato.name, starterTomato.category, starterTomato.purchase_unit)

  // ---------- Bill A: new vendor + starter item + two new items, GST + transport
  const billA = await saveBill({
    billDate: '2026-08-09',
    vendor: { kind: 'new', name: 'Zz Smoke Traders', category: 'VEG' },
    lines: [
      { item: { kind: 'starter', starterId: starterTomato.starter_id, unit: starterTomato.purchase_unit }, qty: '10', rate: '40' },
      { item: { kind: 'new', name: 'Zz Smoke Masala', category: 'DRY', unit: 'kg' }, qty: '2.5', rate: '333.33' },
      { item: { kind: 'new', name: 'Zz Smoke Oil', category: 'DRY', unit: 'litre' }, qty: '3', rate: '150' },
    ],
    gstTotal: '50',
    transport: '100',
  })
  assert.ok(billA.ok, `bill A failed: ${billA.ok === false ? billA.error : ''}`)
  assert.equal(billA.vendor.created, true)
  assert.equal(billA.vendor.code, 'V-VEG-01')
  assert.equal(billA.createdItems.length, 3)
  assert.equal(billA.purchase.lineCount, 3)
  // goods 400 + 833.325 + 450 = 1683.325; + gst 50 + transport 100
  assert.equal(billA.purchase.goodsTotal, '1683.325')
  assert.equal(billA.purchase.billTotal, '1833.325')
  assert.equal(billA.dues.balance, '1833.325')

  const tomatoCreated = billA.createdItems.find((i) => i.name === starterTomato.name)
  const masalaCreated = billA.createdItems.find((i) => i.name === 'Zz Smoke Masala')
  const oilCreated = billA.createdItems.find((i) => i.name === 'Zz Smoke Oil')
  assert.ok(tomatoCreated && masalaCreated && oilCreated, 'all three items should be created')
  assert.equal(tomatoCreated.code, `${starterTomato.category}-001`)
  assert.equal(masalaCreated.code, 'DRY-001')
  assert.equal(oilCreated.code, 'DRY-002')

  // transport allocation: 23.76 / 49.50+0.01 / 26.73 — residual on the largest line
  const allocRows = (await sql`
    select i.name, pl.transport_alloc::text as alloc, pl.landed::text as landed
    from purchase_lines pl join items i on i.id = pl.item_id
    where pl.purchase_id = ${billA.purchase.id}`) as unknown as { name: string; alloc: string; landed: string }[]
  const alloc = Object.fromEntries(allocRows.map((r) => [r.name, r.alloc]))
  assert.equal(alloc[starterTomato.name], '23.76')
  assert.equal(alloc['Zz Smoke Masala'], '49.51')
  assert.equal(alloc['Zz Smoke Oil'], '26.73')

  // prefill flows from the item_rates view after the first purchase
  const masalaHits = await searchItems(restaurant.id, 'zz smoke masala')
  const masalaItem = masalaHits.find((h) => h.kind === 'item')
  assert.ok(masalaItem && masalaItem.kind === 'item', 'masala should now be a real item')
  assert.equal(masalaItem.prefill_rate, '333.33')

  const tomatoAfter = await searchItems(restaurant.id, starterTomato.name)
  const tomatoItem = tomatoAfter.find((h) => h.kind === 'item' && h.name === starterTomato.name)
  assert.ok(tomatoItem && tomatoItem.kind === 'item', 'tomato should now be a real item')
  assert.equal(tomatoItem.prefill_rate, '40')
  assert.ok(
    !tomatoAfter.some((h) => h.kind === 'starter' && h.name.toLowerCase() === starterTomato.name.toLowerCase()),
    'materialized starter must vanish from starter suggestions',
  )

  // vendor typeahead shows the balance from vendor_dues
  const vhits = await searchVendors(restaurant.id, 'zz smoke')
  assert.equal(vhits.length, 1)
  assert.equal(vhits[0].code, 'V-VEG-01')
  assert.equal(vhits[0].balance, '1833.325')

  // ---------- Bill B: everything existing — the fast re-entry path
  const billB = await saveBill({
    billDate: '2026-08-09',
    vendor: { kind: 'existing', id: billA.vendor.id },
    lines: [
      { item: { kind: 'existing', id: masalaItem.id }, qty: '1', rate: '333.33' },
      { item: { kind: 'existing', id: tomatoItem.id }, qty: '2', rate: '40' },
    ],
    gstTotal: '0',
    transport: '0',
  })
  assert.ok(billB.ok, `bill B failed: ${billB.ok === false ? billB.error : ''}`)
  assert.equal(billB.vendor.created, false)
  assert.equal(billB.createdItems.length, 0)
  assert.equal(billB.purchase.billTotal, '413.33')
  assert.equal(billB.dues.balance, '2246.655') // 1833.325 + 413.33

  console.log('ALL SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        purchases: [billA.purchase.id, billB.purchase.id],
        items: billA.createdItems.map((i) => i.id),
        vendor: billA.vendor.id,
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e)
  process.exit(1)
})
