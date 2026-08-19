// Phase-13 smoke: the cashier group against the live DB through the real
// server modules. Proves: LAW 2 bites at the write path (partner, payment
// mode, non-revenue reason must be ACTIVE list values); settlements sum
// per partner with an outstanding column; off-book CASH lands on the
// day-close ladder (and only cash); a dish giveaway FREEZES cost_value
// from dish_costs; dues net per normalized party in dues_outstanding.
//
// Test dates live in Jul 2001. A day_closes row is inserted directly
// (kb_app INSERT) on a 2001 date to exercise the ladder view without
// touching the real chain; everything created is printed for cleanup as
// postgres. Real rows are never touched.
//
// Run: npm run smoke:groups-cashier
import assert from 'node:assert/strict'
import { ensureSmokeAccount } from './smoke-account'

process.loadEnvFile('.env.local')

// Money forms now refuse a blank account. Smokes resolve a real one at
// runtime; see ensureSmokeAccount below.
let ACCOUNT = ''

const SETTLE_START = '2001-07-01'
const SETTLE_END = '2001-07-07'
const CLOSE_DATE = '2001-07-02'
const NEXT_DATE = '2001-07-03'
const NR_DATE = '2001-07-04'

async function main() {
  const { getRestaurant } = await import('../src/server/queries')
  const {
    saveSettlement, voidSettlement, saveOffBook, voidOffBook,
    saveNonRevenues, voidNonRevenue, saveDue, voidDue,
  } = await import('../src/server/cashier-actions')
  const {
    getPartnerSummaries, getDuesOutstanding, getGiveawayMonth, listGiveawayDishes,
  } = await import('../src/server/cashier-queries')
  const { getClosePrefill, getLadderDay } = await import('../src/server/cash-queries')
  const { getList } = await import('../src/server/settings')
  const { listPartners } = await import('../src/server/cashier-queries')
  const { createRecipe, addLine } = await import('../src/server/recipes-actions')
  const { searchIssuableItems } = await import('../src/server/store-queries')
  const { getKitchenSections } = await import('../src/server/kitchen-queries')
  const { decimalStringToPaise } = await import('../src/lib/money')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  ACCOUNT = await ensureSmokeAccount(rid)
  console.log('restaurant:', restaurant.name)

  // ---- 0. the lists are seeded and ordered.
  // Partners are NOT a list — they are a master table carrying
  // agreed_commission_pct, which a list_options row could never hold.
  const partners = await listPartners(rid)
  assert.ok(partners.length > 0, 'partners master has rows')
  assert.ok(
    partners.every((p) => p.name.trim() !== ''),
    'every partner has a name the settlement form can match on',
  )
  assert.equal((await getList(rid, 'payment_mode')).length, 4)
  assert.ok((await getList(rid, 'voucher_category')).includes('Owner reimbursement'))
  assert.ok((await getList(rid, 'non_revenue_reason')).includes('Staff meal'))
  assert.ok((await getList(rid, 'other_income_item')).length >= 5)
  assert.ok((await getList(rid, 'expense_category')).length >= 9)

  // ---- 1. settlements: LAW 2 at the write path, then per-partner math
  const badPartner = await saveSettlement({
    partner: 'Zz Nowhere', periodStart: SETTLE_START, periodEnd: SETTLE_END,
    grossSales: '1000', commission: '', otherDeductions: '', amountReceived: '', receivedDate: '', note: '',
    billedByUs: '', claimedByThem: '', reference: '', deductions: [], accountId: ACCOUNT })
  // the partner now comes from the partners MASTER, not list_options — the
  // refusal points at Sales → Partners, where the agreed commission lives
  assert.ok(!badPartner.ok && /partner/i.test(badPartner.error), 'unknown partner refused by name')

  const s1 = await saveSettlement({
    partner: 'Swiggy', periodStart: SETTLE_START, periodEnd: SETTLE_END,
    grossSales: '10000', commission: '2200', otherDeductions: '300',
    amountReceived: '7500', receivedDate: '2001-07-09', note: 'zz cashier smoke',
    billedByUs: '10000', claimedByThem: '9600', reference: '', deductions: [], accountId: ACCOUNT })
  assert.ok(s1.ok, `settlement failed: ${s1.ok === false ? s1.error : ''}`)
  const s2 = await saveSettlement({
    partner: 'Zomato', periodStart: SETTLE_START, periodEnd: SETTLE_END,
    grossSales: '8000', commission: '1800', otherDeductions: '', amountReceived: '', receivedDate: '', note: 'zz cashier smoke',
    billedByUs: '', claimedByThem: '', reference: '', deductions: [], accountId: ACCOUNT })
  assert.ok(s2.ok)

  let summaries = await getPartnerSummaries(rid, '2000-01-01', '2100-01-01')
  const swiggy = summaries.find((s) => s.partner === 'Swiggy')
  const zomato = summaries.find((s) => s.partner === 'Zomato')
  assert.ok(swiggy && zomato)
  assert.equal(decimalStringToPaise(swiggy.outstanding), 0, '10000 − 2200 − 300 − 7500 = 0: Swiggy square')
  assert.equal(decimalStringToPaise(zomato.outstanding), 620000, 'Zomato still owes 8000 − 1800 = 6200')

  const sv = await voidSettlement(s2.settlement.id)
  assert.ok(sv.ok)
  summaries = await getPartnerSummaries(rid, '2000-01-01', '2100-01-01')
  const zomato2 = summaries.find((s) => s.partner === 'Zomato')
  assert.ok(zomato2)
  assert.equal(decimalStringToPaise(zomato2.outstanding), 0, 'void nets the partner summary')

  // ---- 2. off-book: mode from the list; CASH joins the drawer ladder
  const badMode = await saveOffBook({ date: CLOSE_DATE, description: 'zz', amount: '100', paymentMode: 'Barter', note: '', customer: '', receivedInto: '', lines: [], accountId: ACCOUNT })
  assert.ok(!badMode.ok && /list/i.test(badMode.error))
  const ob1 = await saveOffBook({ date: CLOSE_DATE, description: 'zz party order', amount: '1500', paymentMode: 'Cash', note: 'zz cashier smoke', customer: '', receivedInto: '', lines: [], accountId: ACCOUNT })
  assert.ok(ob1.ok, `off-book failed: ${ob1.ok === false ? ob1.error : ''}`)
  const ob2 = await saveOffBook({ date: CLOSE_DATE, description: 'zz upi order', amount: '900', paymentMode: 'UPI', note: 'zz cashier smoke', customer: '', receivedInto: '', lines: [], accountId: ACCOUNT })
  assert.ok(ob2.ok)

  // a 2001 close row straight through the INSERT grant — the ladder view
  // must count cash off-book in expected, and ONLY cash
  await sql`
    insert into day_closes (restaurant_id, close_date, opening_cash, extra_cash_in, handed_over, cash_counted, note)
    values (${rid}, ${CLOSE_DATE}, '100', '0', '0', '1650', 'zz cashier smoke')`
  const ladder = await getLadderDay(rid, CLOSE_DATE)
  assert.ok(ladder, 'ladder row for the smoke close')
  assert.equal(decimalStringToPaise(ladder.off_book_cash), 150000, 'off_book_cash rung = the CASH order only')
  assert.equal(decimalStringToPaise(ladder.expected_cash), 160000, 'expected = 100 opening + 1500 off-book cash')
  assert.equal(decimalStringToPaise(ladder.difference), 165000 - 160000, 'counted 1650 − expected 1600 = 50 over')

  // the chain continues from that close: next day's prefill sees its
  // counted cash as opening, and the day's own off-book cash as a rung
  const ob3 = await saveOffBook({ date: NEXT_DATE, description: 'zz next-day cash', amount: '250', paymentMode: 'Cash', note: 'zz cashier smoke', customer: '', receivedInto: '', lines: [], accountId: ACCOUNT })
  assert.ok(ob3.ok)
  const prefill = await getClosePrefill(rid, NEXT_DATE)
  assert.ok(prefill.ok, `prefill blocked: ${prefill.ok === false ? prefill.error : ''}`)
  assert.equal(decimalStringToPaise(prefill.opening), 165000, 'opening = previous counted')
  assert.equal(decimalStringToPaise(prefill.offBookCash), 25000, 'prefill shows the off-book rung')

  const obVoid = await voidOffBook(ob1.order.id)
  assert.ok(obVoid.ok)
  const ladder2 = await getLadderDay(rid, CLOSE_DATE)
  assert.ok(ladder2)
  assert.equal(decimalStringToPaise(ladder2.off_book_cash), 0, 'void nets the rung out')

  // ---- 3. non-revenue: reason from list; a dish FREEZES its cost
  const sections = await getKitchenSections(rid)
  const ch = sections.find((s) => s.code === 'CH')
  assert.ok(ch)
  const hits = await searchIssuableItems(rid, 'chicken')
  const plt1 = hits.find((h) => h.code === 'PLT-001')
  assert.ok(plt1)
  const dishRes = await createRecipe({ kind: 'dish', name: 'Zz Cashier Dish', sectionId: ch.id, outputQty: '1', outputUnit: 'portion', sellingPrice: '350' })
  assert.ok(dishRes.ok, `create dish failed: ${dishRes.ok === false ? dishRes.error : ''}`)
  const dl = await addLine({ recipeId: dishRes.id, component: { kind: 'item', id: plt1.id }, qty: '0.2' })
  assert.ok(dl.ok)
  const dishes = await listGiveawayDishes(rid)
  const zzDish = dishes.find((d) => d.id === dishRes.id)
  assert.ok(zzDish && zzDish.has_cost && zzDish.selling_price === '350')

  const badReason = await saveNonRevenues({ date: NR_DATE, lines: [{ reason: 'Zz Because', recipeId: dishRes.id, description: '', qty: '1', menuValue: '', givenTo: '', note: '' }] })
  assert.ok(!badReason.ok && /list/i.test(badReason.error))
  const qtyNoDish = await saveNonRevenues({ date: NR_DATE, lines: [{ reason: 'Staff meal', recipeId: '', description: 'zz thing', qty: '2', menuValue: '', givenTo: '', note: '' }] })
  assert.ok(!qtyNoDish.ok && /dish/i.test(qtyNoDish.error))

  const [{ cost: dishCost }] = await sql<{ cost: string }[]>`
    select dish_cost::text as cost from dish_costs where recipe_id = ${dishRes.id}`
  const nr1 = await saveNonRevenues({ date: NR_DATE, lines: [{ reason: 'Staff meal', recipeId: dishRes.id, description: '', qty: '2',
    menuValue: '700', givenTo: 'Zz Staff', note: 'zz cashier smoke' }] })
  assert.ok(nr1.ok, `non-revenue failed: ${nr1.ok === false ? nr1.error : ''}`)
  const [{ v: nrExpected }] = await sql<{ v: string }[]>`select ('2'::numeric * ${dishCost}::numeric)::text as v`
  assert.equal(decimalStringToPaise(nr1.rows[0].cost_value), decimalStringToPaise(nrExpected), 'cost_value FROZEN = qty × dish_cost — the cashier typed no cost')
  assert.equal(nr1.rows[0].menu_value, '700')

  const nr2 = await saveNonRevenues({ date: NR_DATE, lines: [{ reason: 'Complaint recovery', recipeId: '', description: 'zz flowers for a complaint', qty: '',
    menuValue: '', givenTo: '', note: 'zz cashier smoke' }] })
  assert.ok(nr2.ok)
  assert.equal(Number(nr2.rows[0].cost_value), 0, 'no dish → no cost claim')

  let giveaway = await getGiveawayMonth(rid, '2001-07-01')
  assert.equal(decimalStringToPaise(giveaway.cost_value), decimalStringToPaise(nrExpected))
  const nrVoid = await voidNonRevenue(nr1.rows[0].id)
  assert.ok(nrVoid.ok)
  assert.equal(decimalStringToPaise(nrVoid.reversal.cost_value), -decimalStringToPaise(nr1.rows[0].cost_value), 'negative twin copies the frozen cost')
  giveaway = await getGiveawayMonth(rid, '2001-07-01')
  assert.equal(decimalStringToPaise(giveaway.cost_value), 0, 'void nets the month')

  // ---- 4. dues: normalized party netting
  const d1 = await saveDue({ date: NR_DATE, party: 'Zz Ramu', amount: '500', direction: 'given', againstWhat: 'zz advance', ref: '', note: 'zz cashier smoke' })
  assert.ok(d1.ok, `due failed: ${d1.ok === false ? d1.error : ''}`)
  const d2 = await saveDue({ date: NR_DATE, party: 'zz ramu', amount: '200', direction: 'received', againstWhat: '', ref: '', note: 'zz cashier smoke' })
  assert.ok(d2.ok)
  assert.equal(decimalStringToPaise(d2.due.amount), -20000, 'received back is the negative direction')
  let outstanding = await getDuesOutstanding(rid)
  const ramu = outstanding.filter((o) => o.party.toLowerCase().includes('ramu'))
  assert.equal(ramu.length, 1, '“Zz Ramu” and “zz ramu” are ONE ledger — normalized key')
  assert.equal(decimalStringToPaise(ramu[0].balance), 30000, '500 given − 200 back = 300 to collect')

  const dv1 = await voidDue(d1.due.id)
  const dv2 = await voidDue(d2.due.id)
  assert.ok(dv1.ok && dv2.ok)
  outstanding = await getDuesOutstanding(rid)
  assert.equal(outstanding.filter((o) => o.party.toLowerCase().includes('zz ramu')).length, 0, 'voids clear the ledger')

  console.log('ALL CASHIER-GROUP SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        settlements: [s1.settlement.id, s2.settlement.id, sv.ok ? sv.reversal.id : null],
        off_book: [ob1.order.id, ob2.order.id, ob3.order.id, obVoid.ok ? obVoid.reversal.id : null],
        non_revenue: [nr1.rows[0].id, nr2.rows[0].id, nrVoid.ok ? nrVoid.reversal.id : null],
        dues: [d1.due.id, d2.due.id, dv1.ok ? dv1.reversal.id : null, dv2.ok ? dv2.reversal.id : null],
        day_close_date: CLOSE_DATE,
        recipes: [dishRes.id],
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('CASHIER-GROUP SMOKE FAILED:', e)
  process.exit(1)
})
