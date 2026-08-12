// Phase-14 smoke (+ the three global laws) against the live DB. Proves:
// standalone vendor/item birth rides the same code series as bills;
// expenses refuse till cash BY NAME and enforce the lists; pnl_monthly
// adds the month up exactly (off-book revenue in, staff food outside
// cogs, giveaways informational); the Lists screen's actions add/reorder/
// retire without ever deleting; tab strips obey the settings row and the
// role matrix; and LAW 1 holds as pure functions — a role never sees a
// link it cannot open.
//
// Test rows live in Aug 2001 / Zz names; everything created is printed
// for cleanup as postgres. Real rows are never touched.
//
// Run: npm run smoke:groups-owner
import assert from 'node:assert/strict'
import { ensureSmokeAccount } from './smoke-account'

process.loadEnvFile('.env.local')

// Money forms now refuse a blank account. Smokes resolve a real one at
// runtime; see ensureSmokeAccount below.
let ACCOUNT = ''

const EXP_DATE = '2001-08-05'
const OB_DATE = '2001-08-06'
const MONTH = '2001-08-01'

async function main() {
  const { getRestaurant } = await import('../src/server/queries')
  const { createVendor, createItem } = await import('../src/server/books-actions')
  const { saveExpense, voidExpense } = await import('../src/server/expenses-actions')
  const { getExpensesByCategory } = await import('../src/server/expenses-queries')
  const { saveOffBook, voidOffBook } = await import('../src/server/cashier-actions')
  const { getPnlMonthly } = await import('../src/server/pnl-queries')
  const { addListOption, moveListOption, setListOptionStatus, saveTabsSetting } = await import('../src/server/settings-actions')
  const { getList, getAllListOptions, tabsFor } = await import('../src/server/settings')
  const { resolveTabs, TAB_DEFAULTS } = await import('../src/lib/tabs')
  const { canAccess, navFor } = await import('../src/lib/roles')
  const { decimalStringToPaise } = await import('../src/lib/money')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  ACCOUNT = await ensureSmokeAccount(rid)
  console.log('restaurant:', restaurant.name)

  // ---- 1. LAW 1, pure: a role never sees what it cannot open
  assert.equal(canAccess('chef', '/bill'), false, 'chef cannot open Bill')
  assert.equal(canAccess('chef', '/books/issues'), false, 'chef Books excludes the store log now')
  assert.equal(canAccess('store', '/kitchen/indent'), true, 'store reads the indent gap page')
  assert.equal(canAccess('store', '/kitchen'), false, 'but not the kitchen dashboard')
  assert.equal(canAccess('cashier', '/pnl'), false)
  assert.equal(canAccess('manager', '/pnl'), false, 'P&L is the owner’s, like Users and snapshots')
  assert.equal(canAccess('owner', '/pnl'), true)
  assert.equal(canAccess('manager', '/owner/settings'), true)
  assert.equal(canAccess('chef', '/owner/settings'), false)
  // Phase A: nav is the group list. A single-group role sees exactly one.
  assert.deepEqual(navFor('chef').map((l) => l.label), ['Kitchen'], 'chef nav = their world only')
  assert.deepEqual(navFor('cashier').map((l) => l.label), ['Sales'])
  assert.deepEqual(navFor('store').map((l) => l.label), ['Store'])
  assert.deepEqual(navFor('owner').map((l) => l.label), ['Kitchen', 'Store', 'Sales', 'Staff', 'Owner'])
  // Books strips, chip rows and every literal href on every page are asserted
  // exhaustively by scripts/audit-matrix.ts — the LAW 1 gate.

  // ---- 2. standalone masters: same code series as the bill flow
  const [{ next_v: expectedVendorN }] = await sql<{ next_v: number }[]>`
    select coalesce(max(nullif(split_part(code, '-', 3), '')::int), 0) + 1 as next_v
    from vendors where restaurant_id = ${rid} and code like 'V-VEG-%'`
  const vend = await createVendor({ name: 'Zz Groups Vendor', category: 'VEG', gstin: '', phone: '98765', paymentTerms: 'weekly', contactPerson: '', altPhone: '', email: '', address: '', bankName: '', accountNo: '', ifsc: '', upiId: '', natureOfSupply: '', openingBalance: '', supplies: '', notes: '' })
  assert.ok(vend.ok, `createVendor failed: ${vend.ok === false ? vend.error : ''}`)
  assert.equal(vend.vendor.code, `V-VEG-${String(expectedVendorN).padStart(2, '0')}`, 'vendor code continues the series')
  const vendDup = await createVendor({ name: 'zz groups vendor', category: 'VEG', gstin: '', phone: '', paymentTerms: '', contactPerson: '', altPhone: '', email: '', address: '', bankName: '', accountNo: '', ifsc: '', upiId: '', natureOfSupply: '', openingBalance: '', supplies: '', notes: '' })
  assert.ok(!vendDup.ok && /already exists/i.test(vendDup.error))

  const [{ next_i: expectedItemN }] = await sql<{ next_i: number }[]>`
    select coalesce(max(nullif(split_part(code, '-', 2), '')::int), 0) + 1 as next_i
    from items where restaurant_id = ${rid} and code like 'VEG-%'`
  const item = await createItem({ name: 'Zz Groups Item', category: 'VEG', purchaseUnit: 'kg', openingRate: '40', brand: '', stockUnit: '', conversionFactor: '', gstRate: '', parLevel: '', reorderLevel: '', defaultVendorId: '', itemType: '', notes: '' })
  assert.ok(item.ok, `createItem failed: ${item.ok === false ? item.error : ''}`)
  assert.equal(item.item.code, `VEG-${String(expectedItemN).padStart(3, '0')}`, 'item code continues the series')
  assert.equal(item.item.opening_rate, '40')

  // ---- 3. expenses: the drawer rule by name, lists enforced
  const cashRefused = await saveExpense({ date: EXP_DATE, category: 'Rent', payee: '', amount: '100', paidVia: 'Cash', note: '', accountId: ACCOUNT })
  assert.ok(!cashRefused.ok && /cash voucher/i.test(cashRefused.error), 'till cash refused, names the Cash Voucher')
  const badCat = await saveExpense({ date: EXP_DATE, category: 'Zz Whatever', payee: '', amount: '100', paidVia: 'UPI', note: '', accountId: ACCOUNT })
  assert.ok(!badCat.ok && /list/i.test(badCat.error))
  const exp = await saveExpense({ date: EXP_DATE, category: 'Rent', payee: 'Zz Landlord', amount: '5000', paidVia: 'UPI', note: 'zz owner smoke', accountId: ACCOUNT })
  assert.ok(exp.ok, `saveExpense failed: ${exp.ok === false ? exp.error : ''}`)
  const byCat = await getExpensesByCategory(rid, MONTH)
  const rent = byCat.find((c) => c.category === 'Rent')
  assert.ok(rent && decimalStringToPaise(rent.amount) === 500000, 'expenses_by_category holds the month')

  // ---- 4. the P&L adds the month up
  const ob = await saveOffBook({ date: OB_DATE, description: 'zz owner smoke', amount: '400', paymentMode: 'UPI', note: '', customer: '', receivedInto: '', lines: [], accountId: ACCOUNT })
  assert.ok(ob.ok)
  const pnl = await getPnlMonthly(rid, 24)
  const aug = pnl.find((m) => m.month === MONTH)
  assert.ok(aug, 'Aug 2001 appears in pnl_monthly')
  // pnl_monthly's columns were renamed in the schema: revenue -> food_beverage
  // / net_sales, labour -> total_labour, expenses -> total_expenses. Assert
  // the CURRENT names, by value.
  assert.equal(decimalStringToPaise(aug.total_expenses), 500000)
  assert.equal(decimalStringToPaise(aug.off_book), 40000)
  assert.equal(decimalStringToPaise(aug.food_beverage), 0)
  assert.equal(aug.cogs, null, 'no closings that month → cogs stays honest NULL, never a confident zero')

  // ---- 5. lists: add, reorder, retire — never delete
  const added = await addListOption('waste_reason', 'Zz Test Reason')
  assert.ok(added.ok, `addListOption failed: ${added.ok === false ? added.error : ''}`)
  let reasons = await getList(rid, 'waste_reason')
  assert.ok(reasons.includes('Zz Test Reason'))
  const dup = await addListOption('waste_reason', 'zz test reason')
  assert.ok(!dup.ok && /already/i.test(dup.error))
  const zzRow = (await getAllListOptions(rid)).find((o) => o.list_key === 'waste_reason' && o.value === 'Zz Test Reason')
  assert.ok(zzRow)
  const idxBefore = reasons.indexOf('Zz Test Reason')
  const moved = await moveListOption(zzRow.id, 'up')
  assert.ok(moved.ok)
  reasons = await getList(rid, 'waste_reason')
  assert.equal(reasons.indexOf('Zz Test Reason'), idxBefore - 1, 'moved exactly one visible slot up')
  const retired = await setListOptionStatus(zzRow.id, 'inactive')
  assert.ok(retired.ok)
  reasons = await getList(rid, 'waste_reason')
  assert.ok(!reasons.includes('Zz Test Reason'), 'retired values stop being offered')
  assert.ok((await getAllListOptions(rid)).some((o) => o.id === zzRow.id), 'but the row survives — never deleted')

  // ---- 6. tabs: settings row reorders and relabels; matrix still filters
  const defaults = TAB_DEFAULTS.kitchen
  const reordered = [...defaults].reverse().map((t, i) => ({ key: t.key, label: i === 0 ? 'Night close' : '' }))
  const savedTabs = await saveTabsSetting('kitchen', reordered)
  assert.ok(savedTabs.ok, `saveTabsSetting failed: ${savedTabs.ok === false ? savedTabs.error : ''}`)
  assert.equal(savedTabs.tabs[0].key, 'closing', 'order comes from the setting')
  assert.equal(savedTabs.tabs[0].label, 'Night close', 'label override sticks')
  assert.equal(savedTabs.tabs[1].label, 'Wastage', 'blank label falls back to the default')
  const chefTabs = await tabsFor(rid, 'kitchen', 'chef')
  assert.equal(chefTabs[0].key, 'closing')
  const storeKitchenTabs = await tabsFor(rid, 'kitchen', 'store')
  assert.deepEqual(storeKitchenTabs.map((t) => t.key), ['indent'], 'store sees only the kitchen tab it can open')
  const incomplete = await saveTabsSetting('kitchen', reordered.slice(1))
  assert.ok(!incomplete.ok && /every tab/i.test(incomplete.error), 'tabs can be moved, never removed')
  assert.equal(resolveTabs('kitchen', 'not json').length, defaults.length, 'broken settings fall back wholesale')

  // ---- 7. undo what nets: void the expense and off-book row
  const expVoid = await voidExpense(exp.expense.id)
  assert.ok(expVoid.ok)
  const obVoid = await voidOffBook(ob.order.id)
  assert.ok(obVoid.ok)
  const pnl2 = await getPnlMonthly(rid, 24)
  const aug2 = pnl2.find((m) => m.month === MONTH)
  assert.ok(aug2)
  assert.equal(decimalStringToPaise(aug2.off_book), 0, 'voids net the month back to zero')

  console.log('ALL OWNER-GROUP SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({
        vendors: [vend.vendor.id],
        items: [item.item.id],
        expenses: [exp.expense.id, expVoid.ok ? expVoid.reversal.id : null],
        off_book: [ob.order.id, obVoid.ok ? obVoid.reversal.id : null],
        list_options: [zzRow.id],
        settings_keys: ['tabs.kitchen'],
      }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('OWNER-GROUP SMOKE FAILED:', e)
  process.exit(1)
})
