// Phase-11 smoke: the owner's ten questions + the polish contracts.
// Proves: every dashboard card query answers from its named view;
// missing_closes names a sales day until its close lands; negative stock
// raises the alarm and a void clears it; waste-month sums store + kitchen
// and nets voids; unknown statuses count loudly; Indian digit grouping is
// exact; the en/te dictionary has full key parity; the WhatsApp close text
// carries the whole ladder.
//
// Test fixtures live in May 2001 and today (voided in-suite); everything
// created is printed for cleanup as postgres.
//
// Run: npm run smoke:dashboard
import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

async function main() {
  const { getRestaurant } = await import('../src/server/queries')
  const {
    getMissingCloses, getOwed, getStaffCard, getStockAlarms, getUnknownStatusCount,
    getUnmappedSummary, getWasteMonth, getYesterday,
  } = await import('../src/server/dashboard-queries')
  const { normalizePayload, persistFetch } = await import('../src/server/sales-ingest')
  const { closeDay, setFirstOpening } = await import('../src/server/cash-actions')
  const { getClosePrefill } = await import('../src/server/cash-queries')
  const { saveIssue, voidIssue, saveWastage, voidWastage } = await import('../src/server/store-actions')
  const { saveKitchenWastage, voidKitchenWastage } = await import('../src/server/kitchen-actions')
  const { getKitchenSections } = await import('../src/server/kitchen-queries')
  const { getSections, monthStartIST, todayIST } = await import('../src/server/store-queries')
  const { searchIssuableItems } = await import('../src/server/store-queries')
  const { formatPaise, decimalStringToPaise } = await import('../src/lib/money')
  const { DICT, t } = await import('../src/lib/i18n')
  const { buildCloseText, whatsappUrl } = await import('../src/lib/share')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  const monthStart = monthStartIST()
  console.log('restaurant:', restaurant.name)

  // Order-independent close target: on a virgin cash state, seed the opening
  // and use 2001-05-05; when earlier suites left a close chain, extend it by
  // one day so the D-1 law holds either way.
  const [latest] = (await sql`
    select max(close_date)::text as d from day_closes where restaurant_id = ${rid}`) as unknown as { d: string | null }[]
  let SALES_DATE = '2001-05-05'
  const needOpening = latest.d === null
  if (latest.d !== null) {
    const next = new Date(`${latest.d}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    SALES_DATE = next.toISOString().slice(0, 10)
  }

  // ---- 1. Indian digit grouping — one shared formatter, exact
  assert.equal(formatPaise(10450000), '₹1,04,500.00')
  assert.equal(formatPaise(123456789), '₹12,34,567.89')
  assert.equal(formatPaise(-3000), '-₹30.00')
  assert.equal(formatPaise(99), '₹0.99')

  // ---- 2. dictionary parity: te carries every en key, distinctly
  const enKeys = Object.keys(DICT.en).sort()
  const teKeys = Object.keys(DICT.te).sort()
  assert.deepEqual(teKeys, enKeys, 'te must carry exactly the en key set')
  for (const k of enKeys) {
    const v = DICT.te[k as keyof typeof DICT.te]
    assert.ok(v.trim() !== '', `te.${k} must not be empty`)
  }
  assert.equal(t('te', 'date'), 'తేదీ')
  assert.equal(t('en', 'date'), 'Date')

  // ---- 3. baseline cards answer cleanly on a quiet database
  const y = await getYesterday(rid)
  assert.ok(y.date.length === 10)
  assert.equal(y.sales, null)
  assert.equal(y.difference, null)
  const owed = await getOwed(rid)
  assert.ok(Number(owed.vendorTotal) >= 0)
  const staff = await getStaffCard(rid, todayIST())
  assert.ok(staff.activeStaff >= 0 && staff.markedToday >= 0)
  const unmapped0 = await getUnmappedSummary(rid)
  const unknown0 = await getUnknownStatusCount(rid)
  const alarms0 = await getStockAlarms(rid)
  assert.equal(alarms0.length, 0, 'no negative stock at rest')
  // earlier suites in this run leave their own unclosed sales days until the
  // end-of-run cleanup — measure relative to that baseline
  const missing0 = await getMissingCloses(rid)
  assert.ok(!missing0.includes(SALES_DATE), `sales residue for ${SALES_DATE} — clean 2001-era test rows first`)

  // ---- 4. a sales day with no close is NAMED until its close lands
  const payload = {
    order_json: [
      { Order: { orderID: '1', order_date: SALES_DATE, status: 'Success', payment_type: 'Cash', order_type: 'Dine In', order_from: 'POS', no_of_persons: '2', total: '900', core_total: '900', discount_total: '0', tax_total: '0', service_charge: 0, container_charges: '0', round_off: '0' },
        OrderItem: [{ itemid: `ZZT-${SALES_DATE}`, name: 'Zz Dash Item', quantity: '1', total: '900', total_tax: 0, total_discount: 0 }] },
      { Order: { orderID: '2', order_date: SALES_DATE, status: 'Held', payment_type: 'Cash', order_type: 'Dine In', order_from: 'POS', no_of_persons: '0', total: '100', core_total: '100', discount_total: '0', tax_total: '0', service_charge: 0, container_charges: '0', round_off: '0' },
        OrderItem: [] },
    ],
  }
  const fetch1 = await persistFetch(rid, SALES_DATE, normalizePayload(payload, SALES_DATE))
  assert.equal(fetch1.insertedOrders, 2)

  const missing1 = await getMissingCloses(rid)
  assert.ok(missing1.includes(SALES_DATE), 'the unclosed sales day is named')
  assert.equal(missing1.length, missing0.length + 1)
  const unknown1 = await getUnknownStatusCount(rid)
  assert.equal(unknown1, unknown0 + 1, 'the Held order screams from the card')
  const unmapped1 = await getUnmappedSummary(rid)
  assert.equal(unmapped1.items, unmapped0.items + 1)
  assert.equal(Number(unmapped1.revenue) - Number(unmapped0.revenue), 900)

  if (needOpening) {
    const opened = await setFirstOpening({ amount: '1000' })
    assert.ok(opened.ok, `setFirstOpening failed: ${opened.ok === false ? opened.error : ''}`)
  }
  const prefill = await getClosePrefill(rid, SALES_DATE)
  assert.ok(prefill.ok, `prefill blocked: ${prefill.ok === false ? prefill.error : ''}`)
  const expectedPaise = decimalStringToPaise(prefill.opening) + 90000
  const countedStr = (expectedPaise / 100).toFixed(2)
  const closed = await closeDay({
    date: SALES_DATE, extraCashIn: '', handedOver: '', handedTo: '', cashCounted: countedStr, bankSettled: '', note: 'zz dash smoke',
  })
  assert.ok(closed.ok, `closeDay failed: ${closed.ok === false ? closed.error : ''}`)
  assert.equal(Number(closed.ladder.difference), 0, 'opening + 900 POS cash, counted exactly')
  const missing2 = await getMissingCloses(rid)
  assert.ok(!missing2.includes(SALES_DATE), 'closed — off the list')
  assert.equal(missing2.length, missing0.length)

  // ---- 5. the WhatsApp text carries the whole ladder
  const text = buildCloseText(restaurant.name, closed.ladder)
  for (const piece of ['Opening', 'POS cash', 'Other income', 'Extra in', 'Vouchers', 'Handed over', 'Expected', 'Counted', 'Difference']) {
    assert.ok(text.includes(piece), `share text carries ${piece}`)
  }
  assert.ok(text.includes(formatPaise(expectedPaise)))
  assert.ok(whatsappUrl(text).startsWith('https://wa.me/?text='))
  assert.ok(!whatsappUrl(text).includes(' '), 'URL-encoded')

  // ---- 6. negative stock raises the alarm; the void clears it
  const hits = await searchIssuableItems(rid, 'chicken')
  const plt2 = hits.find((h) => h.code === 'PLT-002')
  assert.ok(plt2, 'PLT-002 must be issuable')
  const sections = await getSections(rid)
  const ch = sections.find((s) => s.code === 'CH')
  assert.ok(ch)
  const over = await saveIssue({ issueDate: todayIST(), sectionId: ch.id, lines: [{ itemId: plt2.id, qty: '25', note: '' }] })
  assert.ok(over.ok, `over-issue failed: ${over.ok === false ? over.error : ''}`)
  const alarms1 = await getStockAlarms(rid)
  const alarm = alarms1.find((a) => a.code === 'PLT-002')
  assert.ok(alarm, 'negative stock must appear on the alarm card')
  assert.ok(Number(alarm.on_hand_qty) < 0)
  const overVoid = await voidIssue(over.issue.id)
  assert.ok(overVoid.ok)
  assert.equal((await getStockAlarms(rid)).length, 0, 'void clears the alarm')

  // ---- 7. waste this month: store + kitchen, voids net out
  const waste0 = await getWasteMonth(rid, monthStart)
  const sw = await saveWastage({ wasteDate: todayIST(), itemId: plt2.id, qty: '1', reason: 'Spoilage', note: 'zz dash smoke' })
  assert.ok(sw.ok, `store wastage failed: ${sw.ok === false ? sw.error : ''}`)
  const kitchenSections = await getKitchenSections(rid)
  const kw = await saveKitchenWastage({
    date: todayIST(), sectionId: kitchenSections[0].id, reason: 'Burnt', note: 'zz dash smoke',
    component: { kind: 'none', value: '75' },
  })
  assert.ok(kw.ok, `kitchen wastage failed: ${kw.ok === false ? kw.error : ''}`)
  const waste1 = await getWasteMonth(rid, monthStart)
  assert.equal(
    decimalStringToPaise(waste1.storeValue) - decimalStringToPaise(waste0.storeValue),
    decimalStringToPaise(sw.wastage.value),
  )
  assert.equal(decimalStringToPaise(waste1.kitchenValue) - decimalStringToPaise(waste0.kitchenValue), 7500)
  assert.ok(waste1.reasons.some((r) => r.reason === 'Burnt'))
  const swVoid = await voidWastage(sw.wastage.id)
  const kwVoid = await voidKitchenWastage(kw.wastage.id)
  assert.ok(swVoid.ok && kwVoid.ok)
  const waste2 = await getWasteMonth(rid, monthStart)
  assert.equal(
    decimalStringToPaise(waste2.storeValue),
    decimalStringToPaise(waste0.storeValue),
    'voided store waste nets out',
  )
  assert.equal(
    decimalStringToPaise(waste2.kitchenValue),
    decimalStringToPaise(waste0.kitchenValue),
    'voided kitchen waste nets out',
  )

  console.log('ALL DASHBOARD SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        fetch: fetch1.fetchId,
        sales_date: SALES_DATE,
        close_date: SALES_DATE,
        setting: 'first_opening_cash',
        issues: [over.issue.id, overVoid.ok ? overVoid.reversal.id : null],
        wastage: [sw.wastage.id, swVoid.ok ? swVoid.reversal.id : null],
        kitchen_wastage: [kw.wastage.id, kwVoid.ok ? kwVoid.reversal.id : null],
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('DASHBOARD SMOKE FAILED:', e)
  process.exit(1)
})
