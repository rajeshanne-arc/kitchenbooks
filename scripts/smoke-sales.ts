// Phase-6 smoke: the Petpooja mirror through the real server modules against
// the live DB, with a FIXTURE payload in the API's exact shape (the real HTTP
// call needs PP_* env, which exists only in Vercel — the adapter is one
// isolated function; everything downstream is exercised here).
//
// Proves: two-day filter, status whitelist (unknown surfaced never banked),
// (date,id) keying with duplicate skip, latest-fetch-wins re-fetch, mapping
// shrinks unmapped, section sales + margin land, dish qty-sold.
// Test dates live in 2001 — real data is never touched. Prints created ids
// for cleanup (the app role cannot DELETE).
//
// Run: npm run smoke:sales
import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

const T = '2001-01-05'
const T_PREV = '2001-01-04'
const MONTH = '2001-01-01'

type FixtureOrder = {
  orderID: string
  order_date: string
  status: string
  order_type?: string
  payment_type?: string
  no_of_persons?: string
  total?: string | number
  items?: { itemid: string; name: string; quantity: string; total: string | number }[]
}

function payload(orders: FixtureOrder[]) {
  return {
    code: '200',
    success: '1',
    message: '',
    order_json: orders.map((o) => ({
      Restaurant: { restID: 'zz-test' },
      Customer: {},
      Order: {
        orderID: o.orderID,
        order_date: o.order_date,
        status: o.status,
        order_type: o.order_type ?? 'Dine In',
        payment_type: o.payment_type ?? 'Cash',
        order_from: 'POS',
        no_of_persons: o.no_of_persons ?? '0',
        core_total: o.total ?? '0',
        discount_total: '0',
        tax_total: '0',
        service_charge: 0,
        container_charges: '0',
        round_off: '0',
        total: o.total ?? '0',
      },
      Tax: [],
      Discount: [],
      OrderItem: (o.items ?? []).map((it) => ({
        itemid: it.itemid,
        name: it.name,
        quantity: it.quantity,
        price: it.total,
        total: it.total,
        total_tax: 0,
        total_discount: 0,
      })),
    })),
  }
}

async function main() {
const { businessYesterday } = await import('../src/server/business-day')
    const { getRestaurant } = await import('../src/server/queries')
  const { classifyStatus, normalizePayload, persistFetch } = await import('../src/server/sales-ingest')
  const { mapPosItem, fetchDay } = await import('../src/server/sales-actions')
  const { countUnmapped, getQtySold, getSalesDay, listDishOptions, listUnknownOrders, listUnmapped } = await import('../src/server/sales-queries')
  const { getSectionCosts } = await import('../src/server/labour-queries')
  const { getSections } = await import('../src/server/store-queries')
  const { createRecipe } = await import('../src/server/recipes-actions')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  console.log('restaurant:', restaurant.name, '| yesterday IST:', await businessYesterday())

  // ---- 0. the whitelist is a whitelist
  assert.equal(classifyStatus('Success'), 'revenue')
  assert.equal(classifyStatus('Cancelled'), 'cancelled')
  assert.equal(classifyStatus('Complimentary'), 'complimentary')
  assert.equal(classifyStatus('Held'), 'unknown')
  assert.equal(classifyStatus('success '), 'revenue')

  const before = await getSalesDay(rid, T)
  assert.equal(before, null, `expected no ${T} sales before the smoke — is an earlier run uncleaned?`)

  // ---- 1. one fetch: filter, classify, key, count
  const fixture = payload([
    { orderID: '41', order_date: T, status: 'Success', payment_type: 'Cash', no_of_persons: '4', total: '1000',
      items: [
        { itemid: 'ZZT-1', name: 'Zz Paneer Tikka', quantity: '2', total: '700' },
        { itemid: 'ZZT-2', name: 'Zz Dal', quantity: '1', total: '300' },
      ] },
    { orderID: '55', order_date: T_PREV, status: 'Success', total: '492' }, // D-1 leak — must be filtered
    { orderID: '42', order_date: T, status: 'Cancelled', total: '200',
      items: [{ itemid: 'ZZT-3', name: 'Zz Soup', quantity: '1', total: '200' }] },
    { orderID: '43', order_date: T, status: 'Complimentary', no_of_persons: '2', total: '350',
      items: [{ itemid: 'ZZT-1', name: 'Zz Paneer Tikka', quantity: '1', total: '350' }] },
    { orderID: '44', order_date: T, status: 'Held', total: '150',
      items: [{ itemid: 'ZZT-4', name: 'Zz Mystery', quantity: '1', total: '150' }] },
    { orderID: 'C-9', order_date: T, status: 'Success', payment_type: 'UPI', total: '250',
      items: [{ itemid: 'ZZT-2', name: 'Zz Dal', quantity: '1', total: '250' }] },
    { orderID: '41', order_date: T, status: 'Success', total: '9999' }, // duplicate id — skipped
  ])
  const norm = normalizePayload(fixture, T)
  assert.equal(norm.apiOrderCount, 7)
  assert.equal(norm.orders.length, 5)
  assert.equal(norm.skippedOtherDates, 1)
  assert.equal(norm.otherDates[T_PREV], 1)
  assert.equal(norm.duplicateIds, 1)
  assert.equal(norm.compDisagreements, 1, 'C-9 marked Success must be logged as a disagreement')
  assert.ok(norm.note !== null && /C-prefixed/.test(norm.note))

  const f1 = await persistFetch(rid, T, norm)
  assert.equal(f1.insertedOrders, 5)
  assert.equal(f1.insertedLines, 6, '2 lines on order 41 + one each on 42/43/44/C-9')

  const day1 = await getSalesDay(rid, T)
  assert.ok(day1 !== null)
  assert.equal(day1.orders, 3, 'revenue + comp orders count')
  assert.equal(day1.covers, 6, 'comp covers stay in')
  assert.equal(Number(day1.revenue), 1250, 'comps/cancelled/unknown are OUT of revenue')
  assert.equal(Number(day1.cash_revenue), 1000)
  assert.equal(day1.comps, 1)
  assert.equal(Number(day1.comp_value), 350)
  assert.equal(day1.cancelled, 1)
  assert.equal(day1.unknown_status, 1)
  assert.equal(day1.fetch_count, 1)

  const unknowns = await listUnknownOrders(rid)
  assert.ok(unknowns.some((u) => u.business_date === T && u.pos_order_id === '44' && u.status_raw === 'Held'))

  // ---- 2. re-fetch is a NEW fetch and the latest wins
  const refetch = payload([
    { orderID: '41', order_date: T, status: 'Success', payment_type: 'Cash', no_of_persons: '4', total: '1100',
      items: [
        { itemid: 'ZZT-1', name: 'Zz Paneer Tikka', quantity: '2', total: '800' },
        { itemid: 'ZZT-2', name: 'Zz Dal', quantity: '1', total: '300' },
      ] },
    { orderID: '43', order_date: T, status: 'Complimentary', no_of_persons: '2', total: '350',
      items: [{ itemid: 'ZZT-1', name: 'Zz Paneer Tikka', quantity: '1', total: '350' }] },
    { orderID: '44', order_date: T, status: 'Held', total: '150',
      items: [{ itemid: 'ZZT-4', name: 'Zz Mystery', quantity: '1', total: '150' }] },
    { orderID: 'C-9', order_date: T, status: 'Success', payment_type: 'UPI', total: '250',
      items: [{ itemid: 'ZZT-2', name: 'Zz Dal', quantity: '1', total: '250' }] },
  ])
  const f2 = await persistFetch(rid, T, normalizePayload(refetch, T))
  assert.equal(f2.insertedOrders, 4)
  const day2 = await getSalesDay(rid, T)
  assert.ok(day2 !== null)
  assert.equal(Number(day2.revenue), 1350, 'latest fetch wins — 1100 + 250')
  assert.equal(day2.cancelled, 0, 'the cancelled order is not in the newest fetch')
  assert.equal(day2.fetch_count, 2, 'both fetches remain in history')

  // ---- 3. mapping: biggest money first, picking a dish moves the needle
  const unmapped1 = await listUnmapped(rid)
  const zzRows = unmapped1.filter((u) => u.pos_item_id.startsWith('ZZT-'))
  assert.equal(zzRows.length, 2, 'revenue lines only — cancelled/unknown items never reach the queue')
  assert.deepEqual(zzRows.map((u) => u.pos_item_id), ['ZZT-1', 'ZZT-2'], 'ordered by revenue desc (800 then 550)')
  assert.equal(Number(zzRows[0].revenue), 800)
  assert.equal(Number(zzRows[1].revenue), 550)

  // a dish to map to — use an existing one, else create a Zz dish
  let dishes = await listDishOptions(rid)
  let createdRecipeId: string | null = null
  if (dishes.length === 0) {
    const sections = await getSections(rid)
    const ch = sections.find((s) => s.code === 'CH')
    assert.ok(ch, 'CH section must exist')
    const created = await createRecipe({
      kind: 'dish', name: 'Zz Smoke Dish', sectionId: ch.id, outputQty: '1', outputUnit: 'portion', sellingPrice: '100',
    })
    assert.ok(created.ok, `createRecipe failed: ${created.ok === false ? created.error : ''}`)
    createdRecipeId = created.id
    dishes = await listDishOptions(rid)
  }
  const dish = dishes[0]

  const badMap = await mapPosItem({ posItemId: 'ZZT-1', itemName: 'Zz Paneer Tikka', recipeId: rid, itemId: '', sectionId: '' })
  assert.ok(!badMap.ok && /dish/i.test(badMap.error), 'mapping to a non-dish id must refuse')

  const unmappedBefore = await countUnmapped(rid)
  const mapRes = await mapPosItem({ posItemId: 'ZZT-1', itemName: 'Zz Paneer Tikka', recipeId: dish.id, itemId: '', sectionId: '' })
  assert.ok(mapRes.ok, `mapPosItem failed: ${mapRes.ok === false ? mapRes.error : ''}`)
  assert.equal(mapRes.map.recipe_code, dish.code)
  assert.equal(mapRes.unmappedLeft, unmappedBefore - 1, 'mapping one item shrinks the queue by one')

  // remap is the same move (upsert via the column-granted update)
  const remap = await mapPosItem({ posItemId: 'ZZT-1', itemName: 'Zz Paneer Tikka', recipeId: dish.id, itemId: '', sectionId: '' })
  assert.ok(remap.ok)
  assert.equal(remap.unmappedLeft, unmappedBefore - 1)

  // ---- 4. the join, complete: sales + margin land on the section
  const costs = await getSectionCosts(rid, MONTH)
  const secRow = costs.find((r) => r.section_code === dish.section_code)
  assert.ok(secRow, 'mapped dish section must appear')
  assert.equal(Number(secRow.sales), 800, 'mapped ZZT-1 revenue lands on the dish section')
  assert.equal(Number(secRow.margin), 800, 'no 2001 consumption/labour — margin equals sales')
  const dash = costs.find((r) => r.section_code === '—')
  assert.ok(dash, 'the — / Unmapped row must be loud while ZZT-2 is unmapped')
  assert.equal(Number(dash.sales), 550, 'unmapped revenue shows on the — row')

  // ---- 5. dish cards know their month
  const sold = await getQtySold(rid, MONTH)
  const soldRow = sold.find((s) => s.recipe_id === dish.id)
  assert.ok(soldRow, 'mapped dish must show qty sold')
  assert.equal(Number(soldRow.qty_sold), 2, 'comped and cancelled lines never count as sold')
  assert.equal(Number(soldRow.sales_value), 800)

  // ---- 6. guards on the action's own gate
  const future = await fetchDay({ date: '2077-01-01' })
  assert.ok(!future.ok && /not happened/i.test(future.error))
  const badDate = await fetchDay({ date: '2026-02-30' })
  assert.ok(!badDate.ok)

  console.log('ALL SALES SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        business_date: T,
        fetches: [f1.fetchId, f2.fetchId],
        pos_item_ids: ['ZZT-1'],
        recipe_id: createdRecipeId,
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('SALES SMOKE FAILED:', e)
  process.exit(1)
})
