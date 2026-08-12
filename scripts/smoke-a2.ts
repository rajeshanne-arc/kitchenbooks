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

  /* ── 2c. flagged vouchers reach COGS ──────────────────────────────── */
  //
  // pnl_monthly.purchases UNIONs the purchases table with cash vouchers
  // flagged is_stock_purchase, so a market run paid from the drawer lands
  // inside cost of goods. Same two-source risk as the labour line, so the
  // same discipline: assert the money MOVES, and that an unflagged voucher
  // does not move it.
  console.log('\na flagged voucher reaches COGS')

  const cogsProbe = async (flagged: boolean): Promise<number> => {
    const month = `${new Date().toISOString().slice(0, 7)}-01`
    let before = 0
    let after = 0
    try {
      await sql.begin(async (tx) => {
        const [b] = await tx<{ v: string }[]>`
          select coalesce(cogs, 0)::text as v from pnl_monthly
          where restaurant_id = ${rid} and month = ${month}::date`
        before = Number(b?.v ?? 0)
        await tx`
          insert into cash_vouchers (restaurant_id, voucher_date, amount, paid_to, paid_by,
                                     category, entered_by, is_stock_purchase)
          values (${rid}, ${month}::date, 400, 'Zz market run', 'cashier', 'general', 'gate', ${flagged})`
        const [a] = await tx<{ v: string }[]>`
          select coalesce(cogs, 0)::text as v from pnl_monthly
          where restaurant_id = ${rid} and month = ${month}::date`
        after = Number(a?.v ?? 0)
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    return after - before
  }

  await check('a voucher flagged as a stock purchase moves COGS by its amount', async () => {
    assert.equal(
      await cogsProbe(true),
      400,
      "the UNION in pnl_monthly's pur CTE is broken — drawer-paid goods are outside cost of goods again",
    )
  })

  await check('an UNflagged voucher does NOT move COGS', async () => {
    assert.equal(await cogsProbe(false), 0, 'an ordinary voucher must not reach cost of goods')
  })

  /* ── 2d. money names the account it moved through ─────────────────── */
  //
  // account_id is NULLABLE in the database because history predates
  // accounts and must not be rewritten. The refusal therefore lives in the
  // app, which means nothing but a test can hold it in place — a future
  // form could quietly ship without it and the schema would not object.
  // Two halves: the refusal fires, and a named account actually receives
  // the money.
  console.log('\nmoney names the account it moved through')

  const { AccountRefusal, assertAccount } = await import('../src/server/accounts-queries')

  await check('a blank account is refused BY NAME, never defaulted', async () => {
    await assert.rejects(
      () => assertAccount(rid, ''),
      (e: unknown) =>
        e instanceof AccountRefusal && /account/i.test((e as Error).message),
      'a blank account must be refused in words the cashier can act on',
    )
  })

  await check('an account that is not on the active list is refused', async () => {
    await assert.rejects(
      () => assertAccount(rid, '00000000-0000-4000-8000-000000000000'),
      (e: unknown) => e instanceof AccountRefusal,
    )
  })

  await check('a voucher naming an account moves that account BY ITS AMOUNT', async () => {
    let moved = 0
    let rows = 0
    try {
      await sql.begin(async (tx) => {
        const [acct] = await tx<{ id: string }[]>`
          insert into money_accounts (restaurant_id, name, kind, opening_balance, sort_order)
          values (${rid}, 'Zz gate probe account', 'cash', 0, 999)
          returning id`
        await tx`
          insert into cash_vouchers (restaurant_id, voucher_date, amount, paid_to, paid_by,
                                     category, entered_by, account_id)
          values (${rid}, current_date, 250, 'Zz gate probe', 'cashier', 'general', 'gate', ${acct.id})`
        const [bal] = await tx<{ balance: string }[]>`
          select balance::text as balance from account_balances where account_id = ${acct.id}`
        moved = Number(bal?.balance ?? 0)
        const [mm] = await tx<{ n: number }[]>`
          select count(*)::int as n from money_movements where account_id = ${acct.id}`
        rows = mm?.n ?? 0
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    // A voucher is money OUT: money_movements negates it, so the balance of
    // an account that opened at nothing is exactly minus the amount.
    assert.equal(moved, -250, 'the voucher did not reach account_balances')
    assert.equal(rows, 1, 'the voucher did not appear in money_movements')
  })

  await check('every money-writing action asks assertAccount', async () => {
    // A static read of the source, because the failure this guards against
    // is a NEW form shipped without the refusal — which no runtime test can
    // see, since the form does not exist yet to be run.
    const { readFileSync } = await import('node:fs')
    const WRITERS: [file: string, fn: string][] = [
      ['src/server/books-actions.ts', 'recordPayment'],
      ['src/server/cash-actions.ts', 'saveOtherIncome'],
      ['src/server/cash-actions.ts', 'saveVoucher'],
      ['src/server/cash-actions.ts', 'closeDay'],
      ['src/server/cashier-actions.ts', 'saveOffBook'],
      ['src/server/cashier-actions.ts', 'saveSettlement'],
      ['src/server/expenses-actions.ts', 'saveExpense'],
      ['src/server/expenses-actions.ts', 'saveContractBill'],
      ['src/server/expenses-actions.ts', 'saveCasualLabour'],
    ]
    const missing: string[] = []
    for (const [file, fn] of WRITERS) {
      const src = readFileSync(file, 'utf8')
      const start = src.indexOf(`export async function ${fn}(`)
      if (start === -1) {
        missing.push(`${fn} not found in ${file}`)
        continue
      }
      const next = src.indexOf('export async function ', start + 1)
      const body = src.slice(start, next === -1 ? undefined : next)
      if (!body.includes('assertAccount')) missing.push(`${fn} (${file}) never calls assertAccount`)
    }
    assert.deepEqual(missing, [], missing.join('; '))
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
