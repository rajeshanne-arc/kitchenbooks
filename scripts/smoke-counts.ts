// Phase-8 smoke: counts + photographs through the real server modules
// against the live DB. Proves: book_qty and unit_cost are FROZEN at save
// (stock moves after the count, the count does not), variance math and
// worst-first ordering, the COMPUTED first-count warning (days of issue
// history, voided issues excluded), and the menu photograph (rows equal
// live dish_costs, one photograph per day).
//
// Count rows are observations — they never move stock; everything created
// is printed for cleanup as postgres. Real rows are never touched.
//
// Run: npm run smoke:counts
import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

const COUNT_DATE = '2001-03-01'

async function main() {
const { businessToday } = await import('../src/server/business-day')
    const { getRestaurant } = await import('../src/server/queries')
  const { photographMenu, saveCount } = await import('../src/server/counts-actions')
  const { getCountVariances, getIssueHistoryDays, getSnapshot, listCountableItems, listCounts, listSnapshots } =
    await import('../src/server/counts-queries')
  const { saveIssue, voidIssue, saveWastage, voidWastage } = await import('../src/server/store-actions')
  const { getSections, getStockSnaps } = await import('../src/server/store-queries')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  const today = await businessToday()
  console.log('restaurant:', restaurant.name, '| today IST:', today)

  // ---- 1. the first-count warning is computed, not asserted
  const days0 = await getIssueHistoryDays(rid)
  console.log('issue history days at start:', days0)

  const twentyDaysAgo = (() => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 20)
    return d.toISOString().slice(0, 10)
  })()

  const items = await listCountableItems(rid)
  const plt1 = items.find((i) => i.code === 'PLT-001')
  const plt2 = items.find((i) => i.code === 'PLT-002')
  assert.ok(plt1 && plt2, 'PLT-001 and PLT-002 must exist (real data)')

  const sections = await getSections(rid)
  const ch = sections.find((s) => s.code === 'CH')
  assert.ok(ch, 'CH section must exist')

  const issue = await saveIssue({ issueDate: twentyDaysAgo, sectionId: ch.id, lines: [{ itemId: plt1.id, qty: '0.5', note: '' }], session: 'Morning' })
  assert.ok(issue.ok, `saveIssue failed: ${issue.ok === false ? issue.error : ''}`)
  const daysWithIssue = await getIssueHistoryDays(rid)
  assert.ok(daysWithIssue >= 21, `an issue 20 days back gives ≥21 days of history, got ${daysWithIssue}`)

  const iVoid = await voidIssue(issue.issue.id)
  assert.ok(iVoid.ok, `voidIssue failed: ${iVoid.ok === false ? iVoid.error : ''}`)
  const daysAfterVoid = await getIssueHistoryDays(rid)
  assert.equal(daysAfterVoid, days0, 'voided issues carry no consumption — they leave the history metric')

  // ---- 2. a count freezes book and cost at save
  const [stock1] = await getStockSnaps(rid, [plt1.id])
  const [stock2] = await getStockSnaps(rid, [plt2.id])
  const book1 = Number(stock1.on_hand_qty)
  const book2 = Number(stock2.on_hand_qty)
  const [{ cost1 }] = (await sql`
    select issue_cost::text as cost1 from item_costs where item_id = ${plt1.id}`) as unknown as { cost1: string }[]

  const counted1 = (book1 - 0.5).toString()
  const counted2 = (book2 + 1).toString()
  const res = await saveCount({
    countDate: COUNT_DATE,
    note: 'zz counts smoke',
    lines: [
      { itemId: plt1.id, countedQty: counted1 },
      { itemId: plt2.id, countedQty: counted2 },
    ],
  })
  assert.ok(res.ok, `saveCount failed: ${res.ok === false ? res.error : ''}`)
  assert.equal(res.count.line_count, 2)
  assert.equal(res.historyDays, days0)

  const v1 = res.variances.find((v) => v.code === 'PLT-001')
  const v2 = res.variances.find((v) => v.code === 'PLT-002')
  assert.ok(v1 && v2)
  assert.equal(Number(v1.book_qty), book1, 'book_qty photographed from stock_on_hand')
  assert.equal(v1.unit_cost, cost1, 'unit_cost photographed from item_costs, full precision')
  assert.equal(Number(v1.variance_qty), -0.5)
  assert.equal(Number(v1.variance_value), -0.5 * Number(cost1))
  assert.equal(Number(v2.variance_qty), 1)
  assert.equal(res.variances[0].code, 'PLT-001', 'worst shortage first — negative on top')
  assert.equal(
    Number(res.count.total_variance_value),
    -0.5 * Number(cost1) + 1 * Number(v2.unit_cost),
    'header total equals the stored line values',
  )

  // ---- 3. stock moves on; the count does not
  const waste = await saveWastage({ wasteDate: today, itemId: plt1.id, qty: '1', reason: 'Spoilage', note: 'zz counts smoke' })
  assert.ok(waste.ok, `saveWastage failed: ${waste.ok === false ? waste.error : ''}`)
  const [stockMoved] = await getStockSnaps(rid, [plt1.id])
  assert.equal(Number(stockMoved.on_hand_qty), book1 - 1, 'stock moved')
  const after = await getCountVariances(rid, res.count.id)
  const v1after = after.find((v) => v.code === 'PLT-001')
  assert.ok(v1after)
  assert.equal(Number(v1after.book_qty), book1, 'FROZEN: the count still shows the book as it stood')
  assert.equal(v1after.variance_value, v1.variance_value, 'FROZEN: variance value did not shift')
  const wVoid = await voidWastage(waste.wastage.id)
  assert.ok(wVoid.ok)
  const [stockBack] = await getStockSnaps(rid, [plt1.id])
  assert.equal(Number(stockBack.on_hand_qty), book1, 'stock restored')

  // ---- 4. count validations
  const empty = await saveCount({ countDate: COUNT_DATE, note: '', lines: [] })
  assert.ok(!empty.ok)
  const dup = await saveCount({
    countDate: COUNT_DATE,
    note: '',
    lines: [
      { itemId: plt1.id, countedQty: '1' },
      { itemId: plt1.id, countedQty: '2' },
    ],
  })
  assert.ok(!dup.ok && /twice/i.test(dup.error))
  const zero = await saveCount({ countDate: COUNT_DATE, note: 'zz zero probe', lines: [{ itemId: plt2.id, countedQty: '0' }] })
  assert.ok(zero.ok, 'zero is a real count — an empty shelf is information')

  // ---- 5. photograph the menu
  const snapsBefore = await listSnapshots(rid)
  assert.ok(!snapsBefore.some((s) => s.snap_date === today), 'no photograph for today yet — is an earlier run uncleaned?')
  const [{ live_dishes }] = (await sql`
    select count(*)::int as live_dishes from dish_costs where restaurant_id = ${rid}`) as unknown as { live_dishes: number }[]
  const snap = await photographMenu()
  assert.ok(snap.ok, `photographMenu failed: ${snap.ok === false ? snap.error : ''}`)
  assert.equal(snap.snapDate, today)
  assert.equal(snap.dishes, live_dishes, 'every live dish is in the photograph')

  const snapRows = await getSnapshot(rid, today)
  assert.equal(snapRows.length, live_dishes)
  const [{ mismatches }] = (await sql`
    select count(*)::int as mismatches
    from dish_cost_snapshots s
    join dish_costs d on d.recipe_id = s.recipe_id
    where s.restaurant_id = ${rid} and s.snap_date = ${today}
      and (s.dish_cost is distinct from d.dish_cost)`) as unknown as { mismatches: number }[]
  assert.equal(mismatches, 0, 'photograph equals live costs at the moment it was taken')

  const again = await photographMenu()
  assert.ok(!again.ok && /already photographed/i.test(again.error), 'one photograph per day')

  const snapsList = await listSnapshots(rid)
  assert.ok(snapsList.some((s) => s.snap_date === today && s.dishes === live_dishes))

  const counts = await listCounts(rid)
  assert.ok(counts.some((c) => c.id === res.count.id))

  console.log('ALL COUNTS SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        counts: [res.count.id, zero.ok ? zero.count.id : null],
        issues: [issue.issue.id, iVoid.ok ? iVoid.reversal.id : null],
        wastage: [waste.wastage.id, wVoid.ok ? wVoid.reversal.id : null],
        snapshot_date: today,
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('COUNTS SMOKE FAILED:', e)
  process.exit(1)
})
