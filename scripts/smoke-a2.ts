// Phase A-2 smoke. Two halves:
//
//   1. the period control, PURE — date maths asserted by value, because a
//      period that resolves wrong makes every card on the dashboard lie in
//      the same direction and nothing on screen would look odd.
//   2. every new read query executed against the REAL database. A query that
//      typechecks can still name a column that does not exist; only running
//      it proves otherwise.
//   3. that a cash voucher flagged as casual labour actually MOVES the P&L
//      labour line. That one writes — inside a transaction it deliberately
//      rolls back, so nothing is left behind — because the only way to prove
//      money reaches a total is to move some.
//
// Run: npm run smoke:a2   (exit 1 on any failure)

import assert from 'node:assert/strict'
// period.ts is pure, so it imports statically; everything that touches the
// database is pulled in AFTER the env file is loaded, as the other smokes do.
import { resolvePeriod, isPeriodKey, PERIOD_KEYS } from '../src/lib/period'

process.loadEnvFile('.env.local')

let failures = 0
const check = (name: string, fn: () => void | Promise<void>) => {
  const done = (e?: unknown) => {
    if (e === undefined) console.log(`  ✓ ${name}`)
    else {
      failures++
      console.log(`  ✗ ${name}\n      ${(e as Error).message}`)
    }
  }
  try {
    const r = fn()
    return r instanceof Promise ? r.then(() => done()).catch(done) : Promise.resolve(done())
  } catch (e) {
    return Promise.resolve(done(e))
  }
}

async function main() {
  /* ── 1. the period control, by value ──────────────────────────────── */
  console.log('\nthe period control resolves by value')

  await check('this-month starts on the 1st and ends today', () => {
    const p = resolvePeriod('this-month', '2026-08-11')
    assert.equal(p.from, '2026-08-01')
    assert.equal(p.to, '2026-08-11')
    assert.deepEqual(p.months, ['2026-08-01'])
    assert.equal(p.reportMonth, '2026-08-01')
  })

  await check('last-month covers the whole previous month', () => {
    const p = resolvePeriod('last-month', '2026-08-11')
    assert.equal(p.from, '2026-07-01')
    assert.equal(p.to, '2026-07-31')
    assert.deepEqual(p.months, ['2026-07-01'])
  })

  await check('last-3-months spans three month-starts and ends today', () => {
    const p = resolvePeriod('last-3-months', '2026-08-11')
    assert.equal(p.from, '2026-06-01')
    assert.equal(p.to, '2026-08-11')
    assert.deepEqual(p.months, ['2026-06-01', '2026-07-01', '2026-08-01'])
    // the reporting month is the LAST one — a 3-month period must never
    // blend a food-cost percentage across months
    assert.equal(p.reportMonth, '2026-08-01')
  })

  await check('a period never reports days that have not happened', () => {
    const p = resolvePeriod('this-month', '2026-08-11')
    assert.ok(p.to <= '2026-08-11')
  })

  await check('January rolls the year backwards', () => {
    const p = resolvePeriod('last-3-months', '2026-01-15')
    assert.deepEqual(p.months, ['2025-11-01', '2025-12-01', '2026-01-01'])
    assert.equal(p.from, '2025-11-01')
  })

  await check('last-month from March lands on February, leap year included', () => {
    assert.equal(resolvePeriod('last-month', '2024-03-10').to, '2024-02-29')
    assert.equal(resolvePeriod('last-month', '2026-03-10').to, '2026-02-28')
  })

  await check('an unknown period string is refused', () => {
    assert.equal(isPeriodKey('this-month'), true)
    assert.equal(isPeriodKey('all-time'), false)
    assert.equal(isPeriodKey(undefined), false)
    assert.equal(PERIOD_KEYS.length, 3)
  })

  /* ── 2. every new query runs against the real database ────────────── */
  console.log('\nevery new query runs against the real database')

  const { getRestaurant } = await import('../src/server/queries')
  const { getEntryPulse, getSalesSeries, getSectionCostsRange, getSettlementGap, getWasteRange } =
    await import('../src/server/dashboard-queries')
  const { getRecurringExpenseOffers } = await import('../src/server/expenses-queries')
  const { getList } = await import('../src/server/settings')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  const period = resolvePeriod('last-3-months', new Date().toISOString().slice(0, 10))

  await check('getEntryPulse returns six integer counts', async () => {
    const p = await getEntryPulse(rid, period.from, period.to)
    for (const k of ['bills', 'issues', 'salesDays', 'closes', 'kitchenClosings', 'expenses'] as const) {
      assert.equal(typeof p[k], 'number', `${k} should be a number, got ${typeof p[k]}`)
      assert.ok(p[k] >= 0, `${k} should not be negative`)
    }
  })

  await check('getSalesSeries returns dated points in ascending order', async () => {
    const rows = await getSalesSeries(rid, period.from, period.to)
    let prev = ''
    for (const r of rows) {
      assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/)
      assert.ok(r.date > prev, 'sales series must be ascending and unique by date')
      prev = r.date
    }
  })

  await check('getSettlementGap runs and gap equals billed minus claimed', async () => {
    const rows = await getSettlementGap(rid, period.from, period.to)
    for (const r of rows) {
      const expected = Number(r.billed) - Number(r.claimed)
      assert.ok(
        Math.abs(Number(r.gap) - expected) < 0.005,
        `gap ${r.gap} should equal billed ${r.billed} − claimed ${r.claimed} for ${r.partner}`,
      )
      assert.ok(r.settlements > 0)
    }
  })

  await check('getSectionCostsRange runs over several months', async () => {
    const rows = await getSectionCostsRange(rid, period.months)
    for (const r of rows) {
      assert.equal(typeof r.section_code, 'string')
      // margin is sales − total_cost, summed; the view owns the arithmetic
      const expected = Number(r.sales) - Number(r.total_cost)
      assert.ok(
        Math.abs(Number(r.margin) - expected) < 0.005,
        `margin ${r.margin} should equal sales ${r.sales} − cost ${r.total_cost} for ${r.section_code}`,
      )
    }
  })

  await check('getWasteRange returns totals and reasons', async () => {
    const w = await getWasteRange(rid, period.from, period.to)
    assert.ok(!Number.isNaN(Number(w.storeValue)))
    assert.ok(!Number.isNaN(Number(w.kitchenValue)))
    for (const r of w.reasons) {
      assert.ok(Number(r.value) > 0, 'a listed waste reason must carry value')
      assert.notEqual(r.reason, 'void', 'void rows are not a reason')
    }
  })

  await check('getRecurringExpenseOffers runs and never offers a dead category', async () => {
    const rows = await getRecurringExpenseOffers(rid, period.reportMonth)
    for (const r of rows) {
      assert.ok(Number(r.last_amount) > 0, 'an offered category must have had money last month')
      assert.equal(typeof r.done_this_month, 'boolean')
    }
  })

  /* ── 2b. the labour line has TWO sources ──────────────────────────── */
  //
  // pnl_monthly.casual_labour UNIONs the casual_labour table with cash
  // vouchers flagged is_casual_labour. A total fed from two places can
  // silently halve when either side changes, and neither a type check nor
  // a column-exists check would notice — so this asserts the MONEY MOVES,
  // inside a transaction that rolls back so nothing is left behind.
  console.log('\na flagged voucher reaches the P&L labour line')

  const { sql } = await import('../src/lib/db')

  await check('a cash voucher flagged as casual labour lands on pnl_monthly.casual_labour', async () => {
    const month = `${new Date().toISOString().slice(0, 7)}-01`
    let before = 0
    let after = 0
    try {
      await sql.begin(async (tx) => {
        const [b] = await tx<{ v: string }[]>`
          select coalesce(casual_labour, 0)::text as v from pnl_monthly
          where restaurant_id = ${rid} and month = ${month}::date`
        before = Number(b?.v ?? 0)
        await tx`
          insert into cash_vouchers (restaurant_id, voucher_date, amount, paid_to, paid_by,
                                     category, entered_by, is_casual_labour)
          values (${rid}, ${month}::date, 800, 'Zz gate probe', 'cashier', 'general', 'gate', true)`
        const [a] = await tx<{ v: string }[]>`
          select coalesce(casual_labour, 0)::text as v from pnl_monthly
          where restaurant_id = ${rid} and month = ${month}::date`
        after = Number(a?.v ?? 0)
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    assert.equal(
      after - before,
      800,
      `a flagged voucher must move the labour line by its amount — the UNION in pnl_monthly's cas CTE is broken (before ${before}, after ${after})`,
    )
  })

  await check('an UNflagged voucher does NOT touch the labour line', async () => {
    const month = `${new Date().toISOString().slice(0, 7)}-01`
    let before = 0
    let after = 0
    try {
      await sql.begin(async (tx) => {
        const [b] = await tx<{ v: string }[]>`
          select coalesce(casual_labour, 0)::text as v from pnl_monthly
          where restaurant_id = ${rid} and month = ${month}::date`
        before = Number(b?.v ?? 0)
        await tx`
          insert into cash_vouchers (restaurant_id, voucher_date, amount, paid_to, paid_by,
                                     category, entered_by, is_casual_labour)
          values (${rid}, ${month}::date, 800, 'Zz gate probe', 'cashier', 'general', 'gate', false)`
        const [a] = await tx<{ v: string }[]>`
          select coalesce(casual_labour, 0)::text as v from pnl_monthly
          where restaurant_id = ${rid} and month = ${month}::date`
        after = Number(a?.v ?? 0)
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    assert.equal(after - before, 0, 'an ordinary voucher must not reach the labour line')
  })

  /* ── 3. the return path's list is real ────────────────────────────── */
  console.log('\nthe return reason list is live')

  await check('return_reason is a managed list with values', async () => {
    const reasons = await getList(rid, 'return_reason')
    assert.ok(reasons.length > 0, 'return_reason has no active options — the Return toggle would be unusable')
    console.log(`      ${reasons.join(' · ')}`)
  })

  console.log(
    failures === 0 ? '\nALL PHASE A-2 SMOKE ASSERTIONS PASSED' : `\n${failures} PHASE A-2 ASSERTION(S) FAILED`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
