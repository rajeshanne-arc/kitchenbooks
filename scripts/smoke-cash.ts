// Phase-7 smoke: the cashier's close through the real server modules against
// the live DB. Proves: set-opening is one-time (refuses once any close
// exists), the D-1 HARD STOP names the missing date, opening prefills from
// the previous day's COUNTED cash, owner-funded vouchers NEVER touch the
// drawer math, other income joins the ladder, re-filing wins with a
// corrected marker, and owners_owed nets pocket-money against
// owner_reimbursement vouchers.
//
// Test dates live in Feb 2001. EXPECTS: no day_closes rows and no
// first_opening_cash setting (true until the cash phase is in real use).
// Prints cleanup markers — clean as postgres, then re-verify.
//
// Run: npm run smoke:cash
import assert from 'node:assert/strict'
import { ensureSmokeAccount } from './smoke-account'

process.loadEnvFile('.env.local')

// Money forms now refuse a blank account. Smokes resolve a real one at
// runtime; see ensureSmokeAccount below.
let ACCOUNT = ''

const D1 = '2001-02-01'
const D2 = '2001-02-02'
const D3 = '2001-02-03'

async function main() {
  const { getRestaurant } = await import('../src/server/queries')
  const { closeDay, saveOtherIncome, saveVoucher, setFirstOpening } = await import('../src/server/cash-actions')
  const { getClosePrefill, getLadder, getLadderDay, getOwnerNames, getOwnersOwed } =
    await import('../src/server/cash-queries')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  ACCOUNT = await ensureSmokeAccount(rid)
  console.log('restaurant:', restaurant.name)

  // ---- preconditions: virgin cash state
  const [{ n: closes }] = (await sql`select count(*)::int as n from day_closes where restaurant_id = ${rid}`) as unknown as { n: number }[]
  assert.equal(closes, 0, 'expected zero day_closes — is an earlier smoke uncleaned or the feature already in use?')
  const [setting] = (await sql`
    select value from settings where restaurant_id = ${rid} and key = 'first_opening_cash'`) as unknown as { value: string }[]
  assert.equal(setting, undefined, 'expected no first_opening_cash setting yet')

  // ---- 1. nothing can close before the opening exists
  const blocked = await getClosePrefill(rid, D1)
  assert.ok(!blocked.ok && blocked.blocked === 'no_opening')
  const early = await closeDay({ date: D1, extraCashIn: '', handedOver: '', handedTo: '', cashCounted: '100', bankSettled: '', note: '', bankAccountId: ACCOUNT })
  assert.ok(!early.ok && /opening/i.test(early.error))

  // ---- 2. set opening — repeatable while no close exists
  const set1 = await setFirstOpening({ amount: '4800' })
  assert.ok(set1.ok, `setFirstOpening failed: ${set1.ok === false ? set1.error : ''}`)
  const set2 = await setFirstOpening({ amount: '5000' })
  assert.ok(set2.ok && set2.value === '5000', 're-set before any close must be allowed')

  // ---- 3. D1: cashier voucher + owner voucher + other income
  const vCashier = await saveVoucher({
    date: D1, amount: '300', paidTo: 'Zz Veg Vendor', paidBy: 'cashier', ownerName: '', category: 'general', note: 'zz cash smoke', isStockPurchase: false, isCasualLabour: false, accountId: ACCOUNT })
  assert.ok(vCashier.ok, `cashier voucher failed: ${vCashier.ok === false ? vCashier.error : ''}`)
  const vOwner = await saveVoucher({
    date: D1, amount: '1000', paidTo: 'Zz Gas Agency', paidBy: 'owner', ownerName: 'Zz Asheel', category: 'gas', note: '', isStockPurchase: false, isCasualLabour: false, accountId: ACCOUNT })
  assert.ok(vOwner.ok, `owner voucher failed: ${vOwner.ok === false ? vOwner.error : ''}`)
  assert.equal(vOwner.voucher.owner_name, 'Zz Asheel')

  const noName = await saveVoucher({ date: D1, amount: '50', paidTo: 'X', paidBy: 'owner', ownerName: '', category: 'general', note: '', isStockPurchase: false, isCasualLabour: false, accountId: ACCOUNT })
  assert.ok(!noName.ok && /which owner/i.test(noName.error))
  const ownerReimb = await saveVoucher({ date: D1, amount: '50', paidTo: 'X', paidBy: 'owner', ownerName: 'Zz Asheel', category: 'owner_reimbursement', note: '', isStockPurchase: false, isCasualLabour: false, accountId: ACCOUNT })
  assert.ok(!ownerReimb.ok && /cashier/i.test(ownerReimb.error), 'owner-paid reimbursement is nonsense — must refuse')

  const oil = await saveOtherIncome({
    date: D1, item: 'Used oil', qty: '5', unit: 'litre', amount: '400', buyer: 'Zz Biodiesel Co', receivedBy: 'Zz Cashier', accountId: ACCOUNT })
  assert.ok(oil.ok, `other income failed: ${oil.ok === false ? oil.error : ''}`)
  assert.equal(oil.income.qty, '5')
  assert.equal(oil.income.unit, 'litre')

  const noUnit = await saveOtherIncome({ date: D1, item: 'Used oil', qty: '5', unit: '', amount: '400', buyer: '', receivedBy: '', accountId: ACCOUNT })
  assert.ok(!noUnit.ok && /unit/i.test(noUnit.error), 'qty without unit must refuse — FSSAI reconciliation')
  const noQty = await saveOtherIncome({ date: D1, item: 'Scrap', qty: '', unit: 'kg', amount: '100', buyer: '', receivedBy: '', accountId: ACCOUNT })
  assert.ok(!noQty.ok && /quantity/i.test(noQty.error))

  // ---- 4. the ladder for D1: owner money is NOT in the drawer math
  const p1 = await getClosePrefill(rid, D1)
  assert.ok(p1.ok, 'D1 prefill must be open')
  assert.equal(p1.opening, '5000')
  assert.equal(p1.openingSource, 'first_opening_cash')
  assert.equal(Number(p1.posCash), 0)
  assert.equal(Number(p1.otherIncome), 400)
  assert.equal(Number(p1.cashierVouchers), 300, 'the ₹1000 owner voucher must be absent from the drawer math')

  const c1 = await closeDay({
    date: D1, extraCashIn: '', handedOver: '', handedTo: '', cashCounted: '5100', bankSettled: '2500', note: 'zz cash smoke', bankAccountId: ACCOUNT })
  assert.ok(c1.ok, `closeDay D1 failed: ${c1.ok === false ? c1.error : ''}`)
  assert.equal(Number(c1.ladder.expected_cash), 5100, '5000 + 0 + 400 − 300')
  assert.equal(Number(c1.ladder.difference), 0)
  assert.equal(Number(c1.ladder.cashier_vouchers), 300)
  assert.equal(c1.ladder.bank_settled === null ? null : Number(c1.ladder.bank_settled), 2500)
  assert.equal(c1.ladder.filings, 1)

  // ---- 5. one-time means one-time now
  const setLate = await setFirstOpening({ amount: '9999' })
  assert.ok(!setLate.ok && /closes exist/i.test(setLate.error))

  // ---- 6. the HARD STOP names the missing day
  const skip = await closeDay({ date: D3, extraCashIn: '', handedOver: '', handedTo: '', cashCounted: '1', bankSettled: '', note: '', bankAccountId: ACCOUNT })
  assert.ok(!skip.ok && skip.error.includes(D2), `refusal must name ${D2}: ${skip.ok === false ? skip.error : ''}`)

  // ---- 7. D2: opening prefills from D1's COUNTED cash
  const p2 = await getClosePrefill(rid, D2)
  assert.ok(p2.ok)
  assert.equal(p2.opening, '5100', 'opening = previous day COUNTED, never the expected figure')
  assert.equal(p2.openingSource, 'previous counted')

  const c2 = await closeDay({ date: D2, extraCashIn: '', handedOver: '', handedTo: '', cashCounted: '5150', bankSettled: '', note: '', bankAccountId: ACCOUNT })
  assert.ok(c2.ok)
  assert.equal(Number(c2.ladder.difference), 50, 'fifty rupees appeared from nowhere — shown, not hidden')

  // ---- 8. re-filing wins and wears the corrected marker
  const c2b = await closeDay({ date: D2, extraCashIn: '', handedOver: '', handedTo: '', cashCounted: '5100', bankSettled: '', note: 'recount', bankAccountId: ACCOUNT })
  assert.ok(c2b.ok)
  assert.equal(Number(c2b.ladder.difference), 0)
  assert.equal(c2b.ladder.filings, 2, 'both filings on record — latest wins, history visible')
  const d2row = await getLadderDay(rid, D2)
  assert.equal(Number(d2row?.cash_counted), 5100)

  // ---- 9. D3 with extra-in and handed-over
  const p3 = await getClosePrefill(rid, D3)
  assert.ok(p3.ok)
  assert.equal(p3.opening, '5100', 'D3 opens on D2’s corrected count')
  const needName = await closeDay({ date: D3, extraCashIn: '', handedOver: '2000', handedTo: '', cashCounted: '1', bankSettled: '', note: '', bankAccountId: ACCOUNT })
  assert.ok(!needName.ok && /whom/i.test(needName.error))
  const c3 = await closeDay({
    date: D3, extraCashIn: '200', handedOver: '2000', handedTo: 'Zz Owner Safe', cashCounted: '3300', bankSettled: '', note: '', bankAccountId: ACCOUNT })
  assert.ok(c3.ok)
  assert.equal(Number(c3.ladder.expected_cash), 3300, '5100 + 200 − 2000')
  assert.equal(Number(c3.ladder.difference), 0)
  assert.equal(c3.ladder.handed_to, 'Zz Owner Safe')

  // ---- 10. owners owed: one log, netted
  const owed1 = (await getOwnersOwed(rid)).find((o) => o.person === 'Zz Asheel')
  assert.ok(owed1, 'Zz Asheel must appear in owners_owed')
  assert.equal(Number(owed1.balance), 1000)
  const reimb = await saveVoucher({
    date: '2001-02-05', amount: '400', paidTo: 'Zz Asheel', paidBy: 'cashier', ownerName: '', category: 'owner_reimbursement', note: '', isStockPurchase: false, isCasualLabour: false, accountId: ACCOUNT })
  assert.ok(reimb.ok, `reimbursement voucher failed: ${reimb.ok === false ? reimb.error : ''}`)
  const owed2 = (await getOwnersOwed(rid)).find((o) => o.person === 'Zz Asheel')
  assert.ok(owed2)
  assert.equal(Number(owed2.reimbursed), 400)
  assert.equal(Number(owed2.balance), 600, '1000 from pocket − 400 reimbursed')
  const names = await getOwnerNames(rid)
  assert.ok(names.includes('Zz Asheel'), 'the picker learns owner names from prior entries')

  // ---- 11. the ladder page: one row per date, three dates
  const ladder = await getLadder(rid)
  assert.equal(ladder.length, 3)
  assert.deepEqual(ladder.map((l) => l.close_date), [D3, D2, D1])

  console.log('ALL CASH SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        day_close_dates: '2001-02-01..2001-02-03',
        voucher_dates: '2001-02-01..2001-02-05',
        income_dates: '2001-02-01',
        setting: 'first_opening_cash',
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('CASH SMOKE FAILED:', e)
  process.exit(1)
})
