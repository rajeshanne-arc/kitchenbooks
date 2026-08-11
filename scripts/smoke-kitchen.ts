// Phase-9 smoke: the kitchen truth through the real server modules against
// the live DB. Proves: closings are VALUE per section with latest-wins
// re-files (corrected marker), kitchen wastage is value-required with
// optional item+qty detail and void-by-reversal, and section_food_cost
// states opening + issued − closing = consumed ONLY once an ending closing
// exists — "pending closing" before that, and food-cost % only with sales.
//
// Test dates live in Mar/Apr 2001. Issues are voided in-suite so stock and
// consumption net to zero; everything created is printed for cleanup as
// postgres. Real rows are never touched.
//
// Run: npm run smoke:kitchen
import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

const OPENING_DATE = '2001-03-31'
const MONTH = '2001-04-01'
const ISSUE_DATE = '2001-04-15'
const ENDING_DATE = '2001-04-30'
const SALES_DATE = '2001-04-10'

async function main() {
  const { getRestaurant } = await import('../src/server/queries')
  const { saveClosing, saveKitchenWastage, voidKitchenWastage } = await import('../src/server/kitchen-actions')
  const { getClosingChecklist, getFoodCost, getKitchenSections } = await import('../src/server/kitchen-queries')
  const { saveIssue, voidIssue } = await import('../src/server/store-actions')
  const { getStockSnaps } = await import('../src/server/store-queries')
  const { searchIssuableItems } = await import('../src/server/store-queries')
  const { normalizePayload, persistFetch } = await import('../src/server/sales-ingest')
  const { mapPosItem } = await import('../src/server/sales-actions')
  const { listDishOptions } = await import('../src/server/sales-queries')
  const { createRecipe } = await import('../src/server/recipes-actions')
  const { decimalStringToPaise } = await import('../src/lib/money')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  console.log('restaurant:', restaurant.name)

  const kitchenSections = await getKitchenSections(rid)
  assert.equal(kitchenSections.length, 9, 'Kitchen + Bar org units')
  const ch = kitchenSections.find((s) => s.code === 'CH')
  const td = kitchenSections.find((s) => s.code === 'TD')
  assert.ok(ch && td)

  const hits = await searchIssuableItems(rid, 'chicken')
  const plt1 = hits.find((h) => h.code === 'PLT-001')
  assert.ok(plt1, 'PLT-001 must be issuable')
  const stockBefore = Number(plt1.on_hand_qty)

  // ---- 1. closings: value per section, latest wins, corrections visible
  const bad = await saveClosing({ date: MONTH, sectionId: rid, value: '100', note: '' })
  assert.ok(!bad.ok && /kitchen or bar/i.test(bad.error), 'closing must refuse a non-kitchen section id')

  const c0 = await saveClosing({ date: OPENING_DATE, sectionId: ch.id, value: '100', note: 'zz kitchen smoke' })
  assert.ok(c0.ok, `saveClosing failed: ${c0.ok === false ? c0.error : ''}`)
  assert.equal(c0.closing.filings, 1)

  // ---- 2. issues feed the month (voided at the end to restore stock)
  const issueCH = await saveIssue({ issueDate: ISSUE_DATE, sectionId: ch.id, lines: [{ itemId: plt1.id, qty: '2', note: '' }], session: 'Morning' })
  assert.ok(issueCH.ok, `issue CH failed: ${issueCH.ok === false ? issueCH.error : ''}`)
  const issueTD = await saveIssue({ issueDate: '2001-04-10', sectionId: td.id, lines: [{ itemId: plt1.id, qty: '1', note: '' }], session: 'Morning' })
  assert.ok(issueTD.ok, `issue TD failed: ${issueTD.ok === false ? issueTD.error : ''}`)
  const issuedCH = Number(issueCH.issue.total_value)
  const issuedTD = Number(issueTD.issue.total_value)

  // ---- 3. before an ending closing: PENDING, never a confident number
  let fc = await getFoodCost(rid, MONTH)
  let chRow = fc.find((r) => r.section_code === 'CH')
  const tdRow = fc.find((r) => r.section_code === 'TD')
  assert.ok(chRow && tdRow)
  assert.equal(chRow.has_activity, true)
  assert.equal(Number(chRow.opening_value), 100, 'opening = last closing before the month')
  assert.equal(Number(chRow.issued_value), issuedCH)
  assert.equal(Number(tdRow.issued_value), issuedTD)
  assert.equal(chRow.ending_value, null)
  assert.equal(chRow.consumed_total, null, 'no ending closing → pending, the view refuses to guess')
  assert.equal(tdRow.consumed_total, null)

  // ---- 4. ending closing lands; re-file wins and wears the marker
  const c1 = await saveClosing({ date: ENDING_DATE, sectionId: ch.id, value: '200', note: '' })
  assert.ok(c1.ok)
  fc = await getFoodCost(rid, MONTH)
  chRow = fc.find((r) => r.section_code === 'CH')
  assert.ok(chRow)
  assert.equal(Number(chRow.consumed_total), 100 + issuedCH - 200, 'opening + issued − closing')

  const c2 = await saveClosing({ date: ENDING_DATE, sectionId: ch.id, value: '250', note: 'recount' })
  assert.ok(c2.ok)
  assert.equal(c2.closing.filings, 2, 'both filings on record — latest wins')
  assert.equal(Number(c2.closing.closing_value), 250)
  fc = await getFoodCost(rid, MONTH)
  chRow = fc.find((r) => r.section_code === 'CH')
  assert.ok(chRow)
  const consumedCH = 100 + issuedCH - 250
  assert.equal(Number(chRow.consumed_total), consumedCH, 're-filed closing moves the math')

  const checklist = await getClosingChecklist(rid, ENDING_DATE)
  const chCheck = checklist.find((c) => c.code === 'CH')
  assert.ok(chCheck)
  assert.equal(Number(chCheck.closing_value), 250)
  assert.equal(chCheck.filings, 2)
  assert.ok(checklist.filter((c) => c.closing_value === null).length >= 7, 'unclosed sections stay visibly open')

  // ---- 5. kitchen wastage (phase-12 law): a component freezes its cost
  // server-side; value-only takes the chef's number; voids copy exactly
  const noQty = await saveKitchenWastage({
    date: '2001-04-20', sectionId: ch.id, reason: 'Burnt', note: '', component: { kind: 'item', id: plt1.id, qty: '' },
  })
  assert.ok(!noQty.ok && /quantity/i.test(noQty.error))
  const zeroValue = await saveKitchenWastage({
    date: '2001-04-20', sectionId: ch.id, reason: 'Burnt', note: '', component: { kind: 'none', value: '0' },
  })
  assert.ok(!zeroValue.ok && /more than zero/i.test(zeroValue.error))

  const kw1 = await saveKitchenWastage({
    date: '2001-04-20', sectionId: ch.id, reason: 'Burnt gravy', note: 'zz kitchen smoke',
    component: { kind: 'none', value: '50' },
  })
  assert.ok(kw1.ok, `kitchen wastage failed: ${kw1.ok === false ? kw1.error : ''}`)
  const kw2 = await saveKitchenWastage({
    date: '2001-04-21', sectionId: ch.id, reason: 'Dropped', note: '',
    component: { kind: 'item', id: plt1.id, qty: '0.5' },
  })
  assert.ok(kw2.ok)
  assert.equal(kw2.wastage.item_name !== null, true)
  const [{ cost: plt1Cost }] = await sql<{ cost: string }[]>`
    select issue_cost::text as cost from item_costs where item_id = ${plt1.id}`
  const [{ v: kw2Expected }] = await sql<{ v: string }[]>`
    select ('0.5'::numeric * ${plt1Cost}::numeric)::text as v`
  assert.equal(
    decimalStringToPaise(kw2.wastage.value),
    decimalStringToPaise(kw2Expected),
    'component wastage value is FROZEN qty × issue_cost — the chef typed no value',
  )

  fc = await getFoodCost(rid, MONTH)
  chRow = fc.find((r) => r.section_code === 'CH')
  assert.ok(chRow)
  const [{ v: monthWaste }] = await sql<{ v: string }[]>`
    select ('50'::numeric + ${kw2Expected}::numeric)::text as v`
  assert.equal(
    decimalStringToPaise(chRow.kitchen_wastage),
    decimalStringToPaise(monthWaste),
    'both wastage rows in the month column',
  )

  const kv = await voidKitchenWastage(kw2.wastage.id)
  assert.ok(kv.ok, `void failed: ${kv.ok === false ? kv.error : ''}`)
  assert.equal(
    decimalStringToPaise(kv.reversal.value),
    -decimalStringToPaise(kw2.wastage.value),
    'negative twin copies the value exactly',
  )
  assert.equal(Number(kv.reversal.qty), -0.5, 'and the qty, sign flipped')
  const again = await voidKitchenWastage(kw2.wastage.id)
  assert.ok(!again.ok && /already voided/i.test(again.error))
  const revVoid = await voidKitchenWastage(kv.reversal.id)
  assert.ok(!revVoid.ok && /reversal/i.test(revVoid.error))
  fc = await getFoodCost(rid, MONTH)
  chRow = fc.find((r) => r.section_code === 'CH')
  assert.ok(chRow)
  assert.equal(Number(chRow.kitchen_wastage), 50, 'void nets the pair out of the month')

  // ---- 6. food-cost % arrives only with mapped sales
  assert.equal(chRow.food_cost_pct, null, 'no sales yet → no %')
  let dishes = await listDishOptions(rid)
  let createdRecipeId: string | null = null
  let dish = dishes.find((d) => d.section_code === 'CH')
  if (!dish) {
    const created = await createRecipe({
      kind: 'dish', name: 'Zz Kitchen Dish', sectionId: ch.id, outputQty: '1', outputUnit: 'portion', sellingPrice: '100',
    })
    assert.ok(created.ok, `createRecipe failed: ${created.ok === false ? created.error : ''}`)
    createdRecipeId = created.id
    dishes = await listDishOptions(rid)
    dish = dishes.find((d) => d.section_code === 'CH')
  }
  assert.ok(dish)

  const payload = {
    code: '200', success: '1', message: '',
    order_json: [{
      Restaurant: {}, Customer: {},
      Order: {
        orderID: '7', order_date: SALES_DATE, status: 'Success', order_type: 'Dine In',
        payment_type: 'Cash', order_from: 'POS', no_of_persons: '2',
        core_total: '1000', discount_total: '0', tax_total: '0', service_charge: 0,
        container_charges: '0', round_off: '0', total: '1000',
      },
      Tax: [], Discount: [],
      OrderItem: [{ itemid: 'ZZT-9', name: 'Zz Kitchen Item', quantity: '1', price: '1000', total: '1000', total_tax: 0, total_discount: 0 }],
    }],
  }
  const fetch1 = await persistFetch(rid, SALES_DATE, normalizePayload(payload, SALES_DATE))
  assert.equal(fetch1.insertedOrders, 1)
  const mapped = await mapPosItem({ posItemId: 'ZZT-9', itemName: 'Zz Kitchen Item', recipeId: dish.id })
  assert.ok(mapped.ok, `mapPosItem failed: ${mapped.ok === false ? mapped.error : ''}`)

  fc = await getFoodCost(rid, MONTH)
  chRow = fc.find((r) => r.section_code === 'CH')
  assert.ok(chRow)
  assert.equal(Number(chRow.sales_value), 1000)
  const expectPct = (Math.round(1000 * (consumedCH / 1000)) / 10).toFixed(1)
  assert.equal(chRow.food_cost_pct, expectPct, `food cost % = round(100 × ${consumedCH} / 1000, 1)`)

  // ---- 7. undo the issues; stock exactly as found
  const v1 = await voidIssue(issueCH.issue.id)
  const v2 = await voidIssue(issueTD.issue.id)
  assert.ok(v1.ok && v2.ok)
  const [stockAfter] = await getStockSnaps(rid, [plt1.id])
  assert.equal(Number(stockAfter.on_hand_qty), stockBefore, 'stock restored to the real state')

  console.log('ALL KITCHEN SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        closings: [c0.closing.id, c1.ok ? c1.closing.id : null, c2.closing.id],
        kitchen_wastage: [kw1.wastage.id, kw2.wastage.id, kv.ok ? kv.reversal.id : null],
        issues: [issueCH.issue.id, issueTD.issue.id, v1.ok ? v1.reversal.id : null, v2.ok ? v2.reversal.id : null],
        fetch: fetch1.fetchId,
        sales_date: SALES_DATE,
        pos_item_ids: ['ZZT-9'],
        recipe_id: createdRecipeId,
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('KITCHEN SMOKE FAILED:', e)
  process.exit(1)
})
