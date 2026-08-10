// Phase-12 smoke: the kitchen group against the live DB through the real
// server modules. Proves: an indent records the ASK and the stamped issue
// records the GIVE (gap visible, section mismatch refused, issued indents
// closed to further stamps); production freezes cost_per_output_unit and
// refuses dishes; the itemized closing freezes per-line costs and writes
// the header as the exact SUM of stored generated line values; kitchen
// wastage freezes a recipe component's cost; waste reasons come from
// list_options.
//
// Test dates live in Jun 2001. Issues are voided in-suite; everything
// created is printed for cleanup as postgres. Real rows are never touched.
//
// Run: npm run smoke:groups-kitchen
import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

const D1 = '2001-06-10'
const D2 = '2001-06-30'

async function main() {
  const { getRestaurant } = await import('../src/server/queries')
  const {
    saveIndent, cancelIndent, saveProduction, voidProduction,
    saveItemizedClosing, saveKitchenWastage, voidKitchenWastage,
  } = await import('../src/server/kitchen-actions')
  const {
    getIndentDetail, getKitchenSections, getTodaysProductions, getKitchenDay, getWasteByReason,
  } = await import('../src/server/kitchen-queries')
  const { saveIssue, voidIssue } = await import('../src/server/store-actions')
  const {
    searchIssuableItems, getStockSnaps, listOpenIndents, getIndentPrefill, countOpenIndents,
  } = await import('../src/server/store-queries')
  const { createRecipe, addLine } = await import('../src/server/recipes-actions')
  const { getList } = await import('../src/server/settings')
  const { decimalStringToPaise } = await import('../src/lib/money')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  console.log('restaurant:', restaurant.name)

  const sections = await getKitchenSections(rid)
  const ch = sections.find((s) => s.code === 'CH')
  const td = sections.find((s) => s.code === 'TD')
  assert.ok(ch && td)

  const hits = await searchIssuableItems(rid, 'chicken')
  const plt1 = hits.find((h) => h.code === 'PLT-001')
  assert.ok(plt1 && plt1.has_cost, 'PLT-001 must be issuable')
  const stockBefore = Number(plt1.on_hand_qty)
  const [{ cost: itemCost }] = await sql<{ cost: string }[]>`
    select issue_cost::text as cost from item_costs where item_id = ${plt1.id}`

  // ---- fixtures: a Zz sub (2 kg batch of 1 unit PLT-001) and a Zz dish
  const subRes = await createRecipe({ kind: 'sub', name: 'Zz Groups Sub', sectionId: '', outputQty: '2', outputUnit: 'kg', sellingPrice: '' })
  assert.ok(subRes.ok, `create sub failed: ${subRes.ok === false ? subRes.error : ''}`)
  const subId = subRes.id
  const subLine = await addLine({ recipeId: subId, component: { kind: 'item', id: plt1.id }, qty: '1' })
  assert.ok(subLine.ok)
  const dishRes = await createRecipe({ kind: 'dish', name: 'Zz Groups Dish', sectionId: ch.id, outputQty: '1', outputUnit: 'portion', sellingPrice: '500' })
  assert.ok(dishRes.ok, `create dish failed: ${dishRes.ok === false ? dishRes.error : ''}`)
  const dishId = dishRes.id
  const dishLine = await addLine({ recipeId: dishId, component: { kind: 'item', id: plt1.id }, qty: '0.25' })
  assert.ok(dishLine.ok)
  const [{ sub_cost: subCost }] = await sql<{ sub_cost: string }[]>`
    select cost_per_output_unit::text as sub_cost from recipe_costs where recipe_id = ${subId}`
  const [{ dish_cost: dishCost }] = await sql<{ dish_cost: string }[]>`
    select dish_cost::text as dish_cost from dish_costs where recipe_id = ${dishId}`
  assert.ok(subCost !== null && dishCost !== null, 'fixtures must be costable')

  // ---- 1. the indent records the ASK
  const openBefore = await countOpenIndents(rid)
  const ind1 = await saveIndent({ date: D1, sectionId: ch.id, note: 'zz groups smoke', lines: [{ itemId: plt1.id, qty: '2' }] })
  assert.ok(ind1.ok, `saveIndent failed: ${ind1.ok === false ? ind1.error : ''}`)
  assert.equal(ind1.indent.status, 'open')
  assert.equal(await countOpenIndents(rid), openBefore + 1, 'the store-home badge counts it')
  const openCH = await listOpenIndents(rid, ch.id)
  assert.ok(openCH.some((i) => i.id === ind1.indent.id), 'section pick offers the open indent')
  const prefill = await getIndentPrefill(rid, ind1.indent.id)
  assert.ok(prefill && prefill.lines.length === 1 && prefill.lines[0].qty === '2', 'prefill carries the asked qty')

  // ---- 2. the issue answers it: mismatch refused, stamp + status flip
  const wrongSection = await saveIssue({ issueDate: D1, sectionId: td.id, lines: [{ itemId: plt1.id, qty: '1' }], indentId: ind1.indent.id })
  assert.ok(!wrongSection.ok && /belongs to/i.test(wrongSection.error), 'section mismatch is refused, named')
  const issue1 = await saveIssue({ issueDate: D1, sectionId: ch.id, lines: [{ itemId: plt1.id, qty: '1.5' }], indentId: ind1.indent.id })
  assert.ok(issue1.ok, `issue failed: ${issue1.ok === false ? issue1.error : ''}`)
  assert.equal(issue1.issue.indent_id, ind1.indent.id, 'the stamp ties GIVE to ASK')
  assert.equal((await listOpenIndents(rid, ch.id)).some((i) => i.id === ind1.indent.id), false, 'issued indents leave the queue')
  const again = await saveIssue({ issueDate: D1, sectionId: ch.id, lines: [{ itemId: plt1.id, qty: '1' }], indentId: ind1.indent.id })
  assert.ok(!again.ok && /already issued/i.test(again.error))

  // ---- 3. the gap is the point
  const detail = await getIndentDetail(rid, ind1.indent.id)
  assert.ok(detail)
  assert.equal(detail.indent.status, 'issued')
  const gapRow = detail.gap.find((g) => g.item_code === 'PLT-001')
  assert.ok(gapRow)
  assert.equal(Number(gapRow.qty_requested), 2)
  assert.equal(Number(gapRow.qty_issued), 1.5)
  assert.equal(Number(gapRow.gap), -0.5, 'asked 2, given 1.5 — the gap says so')

  // ---- 4. cancel: open only
  const cantCancel = await cancelIndent(ind1.indent.id)
  assert.ok(!cantCancel.ok && /issued/i.test(cantCancel.error))
  const ind2 = await saveIndent({ date: D1, sectionId: td.id, note: 'zz groups smoke', lines: [{ itemId: plt1.id, qty: '1' }] })
  assert.ok(ind2.ok)
  const cancelled = await cancelIndent(ind2.indent.id)
  assert.ok(cancelled.ok && cancelled.indent.status === 'cancelled')

  // ---- 5. production: subs only, cost FROZEN from the recipe card
  const dishProd = await saveProduction({ date: D1, sectionId: ch.id, recipeId: dishId, outputQty: '1', note: '' })
  assert.ok(!dishProd.ok && /dish/i.test(dishProd.error), 'kind=dish refused server-side')
  const prod1 = await saveProduction({ date: D1, sectionId: ch.id, recipeId: subId, outputQty: '3', note: 'zz groups smoke' })
  assert.ok(prod1.ok, `production failed: ${prod1.ok === false ? prod1.error : ''}`)
  assert.equal(decimalStringToPaise(prod1.production.unit_cost), decimalStringToPaise(subCost), 'unit_cost = cost_per_output_unit, frozen')
  const [{ v: prodValue }] = await sql<{ v: string }[]>`select ('3'::numeric * ${subCost}::numeric)::text as v`
  assert.equal(decimalStringToPaise(prod1.production.value), decimalStringToPaise(prodValue), 'value = qty × frozen cost (generated)')
  const suggestions = await getTodaysProductions(rid, ch.id, D1)
  assert.ok(suggestions.some((p) => p.id === prod1.production.id), 'today’s production feeds the closing picker')

  // ---- 6. itemized closing: three kinds, frozen lines, header = SUM
  const close1 = await saveItemizedClosing({
    date: D2, sectionId: ch.id, note: 'zz groups smoke',
    lines: [
      { kind: 'item', id: plt1.id, qty: '1' },
      { kind: 'sub', id: subId, qty: '0.5' },
      { kind: 'dish', id: dishId, qty: '2' },
    ],
  })
  assert.ok(close1.ok, `itemized closing failed: ${close1.ok === false ? close1.error : ''}`)
  assert.equal(close1.lines.length, 3)
  const [{ v: expectTotal }] = await sql<{ v: string }[]>`
    select ('1'::numeric * ${itemCost}::numeric
          + '0.5'::numeric * ${subCost}::numeric
          + '2'::numeric * ${dishCost}::numeric)::text as v`
  assert.equal(decimalStringToPaise(close1.closing.closing_value), decimalStringToPaise(expectTotal), 'header closing_value = SUM of frozen lines')
  const [{ ok: sumOk }] = await sql<{ ok: boolean }[]>`
    select ((select closing_value from kitchen_closings where id = ${close1.closing.id})
          = (select sum(value) from kitchen_closing_lines where closing_id = ${close1.closing.id})) as ok`
  assert.ok(sumOk, 'stored header equals stored generated line values')
  const kinds = close1.lines.map((l) => l.kind).sort()
  assert.deepEqual(kinds, ['dish', 'item', 'sub'])

  // re-file wins, wears the marker
  const close2 = await saveItemizedClosing({
    date: D2, sectionId: ch.id, note: 'recount', lines: [{ kind: 'sub', id: subId, qty: '1' }],
  })
  assert.ok(close2.ok)
  assert.equal(close2.closing.filings, 2, 'both filings on record — latest wins')
  assert.equal(decimalStringToPaise(close2.closing.closing_value), decimalStringToPaise(subCost))

  // zero lines = a real (empty) closing
  const close0 = await saveItemizedClosing({ date: D2, sectionId: td.id, note: 'zz groups smoke', lines: [] })
  assert.ok(close0.ok)
  assert.equal(Number(close0.closing.closing_value), 0, 'zero is a real closing')

  // ---- 7. kitchen wastage with a recipe component: cost frozen
  const kw = await saveKitchenWastage({
    date: D1, sectionId: ch.id, reason: 'Overproduction', note: 'zz groups smoke',
    component: { kind: 'recipe', id: subId, qty: '0.5' },
  })
  assert.ok(kw.ok, `recipe wastage failed: ${kw.ok === false ? kw.error : ''}`)
  const [{ v: kwExpected }] = await sql<{ v: string }[]>`select ('0.5'::numeric * ${subCost}::numeric)::text as v`
  assert.equal(decimalStringToPaise(kw.wastage.value), decimalStringToPaise(kwExpected), 'recipe component value frozen at qty × unit cost')
  assert.equal(kw.wastage.recipe_name, 'Zz Groups Sub')

  // ---- 8. the day view adds up (issued & wasted for D1, closing for D2)
  const day = await getKitchenDay(rid, D1)
  const chDay = day.find((d) => d.section_code === 'CH')
  assert.ok(chDay)
  const [{ v: issuedExpected }] = await sql<{ v: string }[]>`select ('1.5'::numeric * ${itemCost}::numeric)::text as v`
  assert.equal(decimalStringToPaise(chDay.issued), decimalStringToPaise(issuedExpected))
  assert.equal(decimalStringToPaise(chDay.produced), decimalStringToPaise(prodValue))
  assert.equal(decimalStringToPaise(chDay.wasted), decimalStringToPaise(kwExpected))
  const reasons = await getWasteByReason(rid, '2001-06-01')
  assert.ok(reasons.some((r) => r.reason === 'Overproduction'))

  // ---- 9. reasons come from the managed list
  const wasteReasons = await getList(rid, 'waste_reason')
  assert.ok(wasteReasons.length >= 6, 'waste_reason list seeded')
  assert.equal(wasteReasons[0], 'Spoilage', 'sort_order respected')

  // ---- 10. undo: void production, wastage and the issue; stock as found
  const pv = await voidProduction(prod1.production.id)
  assert.ok(pv.ok)
  assert.equal(decimalStringToPaise(pv.reversal.unit_cost), decimalStringToPaise(subCost), 'reversal copies unit_cost EXACTLY')
  const pvAgain = await voidProduction(prod1.production.id)
  assert.ok(!pvAgain.ok && /already voided/i.test(pvAgain.error))
  const kv = await voidKitchenWastage(kw.wastage.id)
  assert.ok(kv.ok)
  const iv = await voidIssue(issue1.issue.id)
  assert.ok(iv.ok)
  const [stockAfter] = await getStockSnaps(rid, [plt1.id])
  assert.equal(Number(stockAfter.on_hand_qty), stockBefore, 'stock restored to the real state')

  console.log('ALL KITCHEN-GROUP SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        indents: [ind1.indent.id, ind2.ok ? ind2.indent.id : null],
        productions: [prod1.production.id, pv.ok ? pv.reversal.id : null],
        closings: [close1.closing.id, close2.ok ? close2.closing.id : null, close0.ok ? close0.closing.id : null],
        kitchen_wastage: [kw.wastage.id, kv.ok ? kv.reversal.id : null],
        issues: [issue1.issue.id, iv.ok ? iv.reversal.id : null],
        recipes: [subId, dishId],
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('KITCHEN-GROUP SMOKE FAILED:', e)
  process.exit(1)
})
