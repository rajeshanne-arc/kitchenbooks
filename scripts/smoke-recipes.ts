// Phase-4 smoke: the DoD through the real server modules — veg bill, sub
// "Basic Gravy" (7 kg batch), dish "Chilli Chicken" coded CH-001, live cost,
// selling price -> food-cost %, then a SECOND onion bill at a higher rate
// and the dish cost MOVES with no re-cost step. Plus the cycle guard.
// Prints created ids for admin cleanup (recipes/lines/bills/items/vendor).
//
// Run: npm run smoke:recipes
import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

const near = (a: string, b: number, msg: string) => {
  const diff = Math.abs(Number(a) - b)
  assert.ok(diff < 0.005, `${msg}: expected ≈${b}, got ${a}`)
}

async function main() {
  const { getRestaurant, searchItems } = await import('../src/server/queries')
  const { saveBill } = await import('../src/server/save-bill')
  const { getSections } = await import('../src/server/store-queries')
  const { addLine, createRecipe, deleteLine, updateLineQty, updateRecipe } = await import(
    '../src/server/recipes-actions'
  )
  const { getRecipeDetail, getRecipeLines, listDishCosts, searchComponents } = await import(
    '../src/server/recipes-queries'
  )
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  console.log('restaurant:', restaurant.name)

  // ---- veg bill: onions + tomatoes from the starter library
  const onionStarter = (await searchItems(rid, 'onions')).find((h) => h.kind === 'starter')
  const tomatoStarter = (await searchItems(rid, 'tomato')).find((h) => h.kind === 'starter')
  assert.ok(onionStarter?.kind === 'starter' && tomatoStarter?.kind === 'starter', 'starters must be available')
  const bill1 = await saveBill({
    billDate: '2026-08-10',
    vendor: { kind: 'new', name: 'Zz Recipe Veggies', category: 'VEG' },
    lines: [
      { item: { kind: 'starter', starterId: onionStarter.starter_id, unit: onionStarter.purchase_unit }, qty: '5', rate: '30' },
      { item: { kind: 'starter', starterId: tomatoStarter.starter_id, unit: tomatoStarter.purchase_unit }, qty: '5', rate: '40' },
    ],
    gstTotal: '0',
    transport: '0',
  })
  assert.ok(bill1.ok, `veg bill failed: ${bill1.ok === false ? bill1.error : ''}`)
  const onionId = bill1.createdItems.find((i) => i.name === onionStarter.name)!.id
  const tomatoId = bill1.createdItems.find((i) => i.name === tomatoStarter.name)!.id

  // ---- sub: Basic Gravy, batch makes 7 kg, from 5+5 kg gross veg
  const sub = await createRecipe({
    kind: 'sub', name: 'Basic Gravy', sectionId: '', outputQty: '7', outputUnit: 'kg', sellingPrice: '',
  })
  assert.ok(sub.ok, `createRecipe sub failed: ${sub.ok === false ? sub.error : ''}`)
  assert.equal(sub.code, 'SUB-001')
  let r = await addLine({ recipeId: sub.id, component: { kind: 'item', id: onionId }, qty: '5' })
  assert.ok(r.ok, 'add onions failed')
  r = await addLine({ recipeId: sub.id, component: { kind: 'item', id: tomatoId }, qty: '5' })
  assert.ok(r.ok, 'add tomatoes failed')
  // batch cost 5×30 + 5×40 = 350 -> 50/kg
  near(r.recipe.total_cost, 350, 'gravy batch cost')
  near(r.recipe.cost_per_output_unit, 50, 'gravy per-kg cost')
  assert.equal(r.recipe.uncosted_lines, 0)

  // ---- dish: Chilli Chicken, section Chinese -> CH-001
  const sections = await getSections(rid)
  const ch = sections.find((s) => s.code === 'CH')!
  const dish = await createRecipe({
    kind: 'dish', name: 'Chilli Chicken', sectionId: ch.id, outputQty: '1', outputUnit: 'portion', sellingPrice: '',
  })
  assert.ok(dish.ok, `createRecipe dish failed: ${dish.ok === false ? dish.error : ''}`)
  assert.equal(dish.code, 'CH-001')

  const plt1 = (await searchComponents(rid, 'chicken boneless', dish.id)).find((h) => h.kind === 'item')
  assert.ok(plt1, 'PLT-001 must be searchable as a component')
  r = await addLine({ recipeId: dish.id, component: { kind: 'item', id: plt1.id }, qty: '0.25' })
  assert.ok(r.ok, 'add chicken failed')
  const gravyHit = (await searchComponents(rid, 'basic gravy', dish.id)).find((h) => h.kind === 'sub')
  assert.ok(gravyHit, 'gravy must be searchable as a sub component')
  r = await addLine({ recipeId: dish.id, component: { kind: 'sub', id: gravyHit.id }, qty: '0.5' })
  assert.ok(r.ok, 'add gravy failed')
  // 0.25×305 + 0.5×50 = 76.25 + 25 = 101.25
  near(r.recipe.total_cost, 101.25, 'dish cost before price')
  assert.equal(r.recipe.food_cost_pct, null, 'no price yet -> no pct')

  // ---- selling price 399 -> food-cost %
  r = await updateRecipe(dish.id, {
    name: 'Chilli Chicken', outputQty: '1', outputUnit: 'portion', sellingPrice: '399', status: 'active',
  })
  assert.ok(r.ok, 'set price failed')
  near(r.recipe.food_cost_pct ?? '0', 25.4, 'food cost % at 399') // round(100*101.25/399, 1)

  const listed = (await listDishCosts(rid)).find((d) => d.recipe_id === dish.id)
  assert.ok(listed && listed.section_code === 'CH', 'dish must list under Chinese')

  // ---- THE POINT: second onion bill at a higher rate moves the dish cost
  const before = await getRecipeDetail(rid, dish.id)
  const bill2 = await saveBill({
    billDate: '2026-08-10',
    vendor: { kind: 'existing', id: bill1.vendor.id },
    lines: [{ item: { kind: 'existing', id: onionId }, qty: '5', rate: '60' }],
    gstTotal: '0',
    transport: '0',
  })
  assert.ok(bill2.ok, `second onion bill failed: ${bill2.ok === false ? bill2.error : ''}`)
  const after = await getRecipeDetail(rid, dish.id)
  // onions wtd-avg now (150+300)/10 = 45 -> gravy (5×45+5×40)/7 /kg; batch 425 -> 60.714…/kg
  // dish 76.25 + 0.5×60.714… = 106.607…
  near(after!.total_cost, 106.607142857, 'dish cost after rate change')
  assert.ok(Number(after!.total_cost) > Number(before!.total_cost), 'cost must MOVE, untouched')
  near(after!.food_cost_pct ?? '0', 26.7, 'pct after rate change')

  // ---- cycle guard: SUB-002 contains SUB-001; adding SUB-002 into SUB-001 must refuse
  const sub2 = await createRecipe({
    kind: 'sub', name: 'Zz Gravy Wrapper', sectionId: '', outputQty: '1', outputUnit: 'kg', sellingPrice: '',
  })
  assert.ok(sub2.ok, 'create sub2 failed')
  assert.equal(sub2.code, 'SUB-002')
  r = await addLine({ recipeId: sub2.id, component: { kind: 'sub', id: sub.id }, qty: '1' })
  assert.ok(r.ok, 'sub2 <- sub1 failed')
  const cyc = await addLine({ recipeId: sub.id, component: { kind: 'sub', id: sub2.id }, qty: '1' })
  assert.ok(!cyc.ok && /loop/i.test(cyc.error), `cycle must be refused, got: ${cyc.ok ? 'ok' : cyc.error}`)
  const self = await addLine({ recipeId: sub.id, component: { kind: 'sub', id: sub.id }, qty: '1' })
  assert.ok(!self.ok, 'self-reference must be refused')

  // ---- editing: change a qty, remove a line (the DELETE grant), cost follows
  const dishLines = await getRecipeLines(dish.id)
  const chickenLine = dishLines.find((l) => !l.is_sub)!
  r = await updateLineQty(chickenLine.id, '0.3')
  assert.ok(r.ok, 'qty edit failed')
  near(r.recipe.total_cost, 0.3 * 305 + 30.357142857, 'cost after qty edit')
  r = await updateLineQty(chickenLine.id, '0.25')
  assert.ok(r.ok, 'qty edit back failed')
  const wrapperLines = await getRecipeLines(sub2.id)
  r = await deleteLine(wrapperLines[0].id)
  assert.ok(r.ok && r.lines.length === 0, 'line delete failed')

  console.log('ALL RECIPES SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        recipes: [sub.id, dish.id, sub2.id],
        purchases: [bill1.purchase.id, bill2.purchase.id],
        items: [onionId, tomatoId],
        vendor: bill1.vendor.id,
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('RECIPES SMOKE FAILED:', e)
  process.exit(1)
})
