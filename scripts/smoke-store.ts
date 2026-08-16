// Phase-3 smoke: the DoD sequence through the real server modules against
// the live DB — issue 5 kg PLT-001 to Chinese (stock 20 -> 15, CH month
// value = 5 × wtd-avg cost), waste 1 kg (stock 14), void the wastage
// (stock 15), void the issue too so every pair nets to zero. Prints created
// ids for cleanup (the app role cannot DELETE). Real rows are never touched.
//
// Run: npm run smoke:store
import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

async function main() {
const { businessMonthStart, businessToday } = await import('../src/server/business-day')
    const { getRestaurant } = await import('../src/server/queries')
  const { saveIssue, saveWastage, voidIssue, voidWastage } = await import('../src/server/store-actions')
  const { getChecklist, getSections, getSectionsWithMonth, getStockSnaps, listStock, searchIssuableItems } = await import('../src/server/store-queries')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const today = await businessToday()
  const monthStart = await businessMonthStart()
  console.log('restaurant:', restaurant.name, '| today IST:', today)

  const sections = await getSections(restaurant.id)
  // 8 seeded in phase 3; phase 5 unified sections into 16 org units
  assert.equal(sections.length, 16, 'expected the 16 unified org units')
  const ch = sections.find((s) => s.code === 'CH')
  assert.ok(ch, 'Chinese section must exist')

  // baseline: PLT-001 has 20 on hand at wtd-avg 305
  const hits = await searchIssuableItems(restaurant.id, 'chicken boneless')
  const plt1 = hits.find((h) => h.code === 'PLT-001')
  assert.ok(plt1, 'PLT-001 must be issuable')
  assert.equal(Number(plt1.on_hand_qty), 20)
  assert.equal(plt1.has_cost, true)

  const chBefore = (await getSectionsWithMonth(restaurant.id, monthStart)).find((s) => s.code === 'CH')
  assert.equal(chBefore?.consumed_value, '0', 'CH must start the month at zero')

  // ---- 1. issue 5 kg to Chinese
  const issue = await saveIssue({
    issueDate: today,
    sectionId: ch.id,
    lines: [{ itemId: plt1.id, qty: '5', note: '' }], session: 'Morning' })
  assert.ok(issue.ok, `saveIssue failed: ${issue.ok === false ? issue.error : ''}`)
  assert.equal(issue.issue.section_code, 'CH')
  assert.equal(issue.lines[0].unit_cost.replace(/0+$/, '').replace(/\.$/, ''), '305')
  assert.equal(issue.issue.total_value, '1525.0000000000000000')
  assert.equal(Number(issue.stock[0].on_hand_qty), 15)

  // stock page + section page agree
  const stockRows = await listStock(restaurant.id, 'PLT-001')
  assert.equal(Number(stockRows[0].on_hand_qty), 15)
  assert.equal(Number(stockRows[0].issued_qty), 5)
  const chAfterIssue = (await getSectionsWithMonth(restaurant.id, monthStart)).find((s) => s.code === 'CH')
  assert.equal(Number(chAfterIssue?.consumed_value), 1525)
  const others = (await getSectionsWithMonth(restaurant.id, monthStart)).filter((s) => s.code !== 'CH')
  assert.ok(others.every((s) => Number(s.consumed_value) === 0), 'all other sections stay at zero')

  // home checklist sees it
  const checklist = await getChecklist(restaurant.id, today)
  assert.equal(checklist.find((c) => c.code === 'CH')?.issues_today, 1)

  // ---- 2. waste 1 kg
  const waste = await saveWastage({
    wasteDate: today,
    itemId: plt1.id,
    qty: '1',
    reason: 'Spoilage',
    note: 'zz store smoke',
  })
  assert.ok(waste.ok, `saveWastage failed: ${waste.ok === false ? waste.error : ''}`)
  assert.equal(Number(waste.wastage.value), 305)
  assert.equal(Number(waste.stock.on_hand_qty), 14)

  // ---- 3. void the wastage -> back to 15
  const wVoid = await voidWastage(waste.wastage.id)
  assert.ok(wVoid.ok, `voidWastage failed: ${wVoid.ok === false ? wVoid.error : ''}`)
  assert.equal(Number(wVoid.stock.on_hand_qty), 15)
  assert.equal(Number(wVoid.reversal.value), -305)
  assert.equal(wVoid.reversal.unit_cost, wVoid.original.unit_cost, 'reversal must copy unit_cost exactly')

  // guards
  const again = await voidWastage(waste.wastage.id)
  assert.ok(!again.ok && /already voided/i.test(again.error))
  const revVoid = await voidWastage(wVoid.reversal.id)
  assert.ok(!revVoid.ok && /reversal/i.test(revVoid.error))

  // ---- 4. void the issue -> CH back to zero, stock back to 20
  const iVoid = await voidIssue(issue.issue.id)
  assert.ok(iVoid.ok, `voidIssue failed: ${iVoid.ok === false ? iVoid.error : ''}`)
  assert.equal(Number(iVoid.monthValue), 0)
  assert.equal(Number(iVoid.stock[0].on_hand_qty), 20)
  const revLines = (await sql`
    select unit_cost::text as unit_cost, qty::text as qty
    from issue_lines where issue_id = ${iVoid.reversal.id}`) as unknown as { unit_cost: string; qty: string }[]
  assert.equal(revLines[0].unit_cost, issue.lines[0].unit_cost, 'issue reversal must copy unit_cost exactly')
  assert.equal(Number(revLines[0].qty), -5)

  const iAgain = await voidIssue(issue.issue.id)
  assert.ok(!iAgain.ok && /already voided/i.test(iAgain.error))

  // final: stock exactly as we found it
  const [finalStock] = await getStockSnaps(restaurant.id, [plt1.id])
  assert.equal(Number(finalStock.on_hand_qty), 20)

  console.log('ALL STORE SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        issues: [issue.issue.id, iVoid.reversal.id],
        wastage: [waste.wastage.id, wVoid.reversal.id],
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('STORE SMOKE FAILED:', e)
  process.exit(1)
})
