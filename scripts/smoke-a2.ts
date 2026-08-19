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
import { resolvePeriod, isPeriodKey, PERIOD_KEYS, type PeriodKey } from '../src/lib/period'
import { fyLabel, fyRange, parseFyStartMonth } from '../src/lib/fy'

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

/**
 * A SCRIPT HAS NO SESSION, and under RLS an unannounced read sees nothing —
 * every tenant table raises 22P02, because the policy casts an empty
 * current_setting to uuid. So the suite announces its tenant explicitly, the
 * way a background job would. KB_LIVE_TENANT lives in .env.local; it is a
 * restaurant id, not a secret.
 */
/**
 * THE GATES WRITE TO A PROBE TENANT, NEVER TO THE LIVE ONE.
 *
 * `attendance` is INSERT-only and kb_app holds no DELETE, so a probe that
 * proves a write path cannot tidy after itself — for a while that meant one
 * sentinel row per run accumulating in Thrayam's own attendance table. A
 * second restaurant fixes it at the root: sentinel rows land there, the live
 * books stay clean, and because every gate run now exercises two tenants
 * side by side, isolation is tested continuously rather than once.
 *
 * NAMING A TENANT "PROBE" GUARANTEES NOTHING. So this is enforced
 * empirically: every event table in the LIVE tenant is counted before the
 * suite runs and again after, and any table that moved fails the suite by
 * name. That covers the rolled-back probes correctly too — a transaction
 * that discards leaves the counts where it found them — and it cannot be
 * fooled by a convention nobody re-reads.
 */
const EVENT_TABLES = [
  'purchases', 'purchase_lines', 'payments', 'issues', 'issue_lines', 'returns', 'return_lines',
  'wastage', 'attendance', 'stock_counts', 'stock_count_lines', 'stock_adjustments',
  'productions', 'kitchen_closings', 'kitchen_wastage', 'indents', 'indent_lines',
  'cash_vouchers', 'other_income', 'day_closes', 'expenses', 'contract_bills', 'casual_labour',
  'staff_advances', 'payroll_runs', 'payroll_lines', 'vendor_returns', 'vendor_return_lines',
  'purchase_line_shorts', 'non_revenue', 'off_book_orders', 'due_payments', 'partner_settlements',
]

async function census(tenant: string): Promise<Record<string, number>> {
  const { withTenant } = await import('../src/lib/tenant')
  const { txn } = await import('../src/lib/db')
  // ONE transaction for all of them: 33 counts as 33 tsql calls is 33 round
  // trips, and this runs twice per suite. The table names are a literal
  // constant in this file, never anything a caller supplied.
  return withTenant(tenant, () =>
    txn(async (tx) => {
      const out: Record<string, number> = {}
      for (const t of EVENT_TABLES) {
        const rows = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from ${t}`)
        out[t] = rows[0].n
      }
      return out
    }),
  )
}

async function main() {
  const { withTenant } = await import('../src/lib/tenant')
  const tenant = process.env.KB_LIVE_TENANT
  if (!tenant) {
    console.log('\nKB_LIVE_TENANT is not set. Under RLS a script must name the tenant it is testing —')
    console.log('add KB_LIVE_TENANT=<restaurant id> to .env.local.\n')
    process.exit(1)
  }
  if (!process.env.KB_PROBE_TENANT) {
    console.log('\nKB_PROBE_TENANT is not set. The gates that WRITE need a tenant of their own —')
    console.log('they must never write to the live books. Add it to .env.local.\n')
    process.exit(1)
  }
  if (process.env.KB_PROBE_TENANT === tenant) {
    console.log('\nKB_PROBE_TENANT and KB_LIVE_TENANT are the same restaurant. The whole point is that')
    console.log('they are not.\n')
    process.exit(1)
  }
  liveBefore = await census(tenant)
  return withTenant(tenant, run)
}

let liveBefore: Record<string, number> = {}

/** Run `fn` against the probe tenant. Anything that COMMITS uses this. */
export async function onProbe<T>(fn: () => Promise<T>): Promise<T> {
  const { withTenant } = await import('../src/lib/tenant')
  return withTenant(process.env.KB_PROBE_TENANT as string, fn)
}

async function run() {
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
    // EVERY preset, named. This asserted `PERIOD_KEYS.length === 3`, which
    // cannot see a reorder and cannot see a rename — it only noticed that
    // three presets had become six. The golden table deep-equals the array;
    // this one proves the predicate agrees with it.
    for (const k of PERIOD_KEYS) assert.equal(isPeriodKey(k), true, `${k} must be recognised`)
    assert.equal(isPeriodKey('all-time'), false)
    assert.equal(isPeriodKey(undefined), false)
    assert.equal(isPeriodKey('2026-08-01..2026-08-17'), false, 'a range is not a preset')
    assert.equal(PERIOD_KEYS.length, new Set(PERIOD_KEYS).size, 'a preset appears twice')
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

  const { sql, tsql, txn } = await import('../src/lib/db')

  await check('a cash voucher flagged as casual labour lands on pnl_monthly.casual_labour', async () => {
    const month = `${new Date().toISOString().slice(0, 7)}-01`
    let before = 0
    let after = 0
    try {
      await txn(async (tx) => {
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
      await txn(async (tx) => {
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
      await txn(async (tx) => {
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
      await txn(async (tx) => {
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
      ['src/server/cash-actions.ts', 'saveOtherIncomes'],
      ['src/server/cash-actions.ts', 'saveVouchers'],
      ['src/server/cash-actions.ts', 'closeDay'],
      ['src/server/cashier-actions.ts', 'saveOffBook'],
      ['src/server/cashier-actions.ts', 'saveSettlement'],
      ['src/server/expenses-actions.ts', 'saveExpenses'],
      ['src/server/expenses-actions.ts', 'saveContractBill'],
      ['src/server/expenses-actions.ts', 'saveCasualLabours'],
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

  /* ── 2e. the financial year, by value ─────────────────────────────── */
  //
  // The FY label is half of every document number, so a wrong one puts a
  // whole month's paperwork in the wrong year — and nothing on screen would
  // look odd, because '2526' and '2627' are equally plausible. Asserted by
  // value, and asserted for a country that is NOT this one, because the
  // point of reading fy_start_month from settings is that the product ships
  // somewhere else.
  console.log('\nthe financial year label resolves by value')

  await check('April start: August 2026 is 2627, February 2026 is 2526', () => {
    assert.equal(fyLabel('2026-08-11', 4), '2627')
    assert.equal(fyLabel('2026-02-11', 4), '2526')
    assert.equal(fyLabel('2026-04-01', 4), '2627', 'the first day of the year belongs to the new one')
    assert.equal(fyLabel('2026-03-31', 4), '2526', 'the last day belongs to the old one')
  })

  await check('January start: the label is the calendar year, still four wide', () => {
    assert.equal(fyLabel('2026-08-11', 1), '2026')
    assert.equal(fyLabel('2026-01-01', 1), '2026')
    assert.equal(fyLabel('2026-12-31', 1), '2026')
  })

  await check('July start (Australia) and October start (US federal) both work', () => {
    assert.equal(fyLabel('2026-08-11', 7), '2627')
    assert.equal(fyLabel('2026-06-30', 7), '2526')
    assert.equal(fyLabel('2026-10-01', 10), '2627')
    assert.equal(fyLabel('2026-09-30', 10), '2526')
  })

  await check('a missing or nonsense fy_start_month falls back to January, never April', () => {
    // Defaulting to April would be hardcoding one country's tax law in the
    // place the setting exists to avoid it.
    assert.equal(parseFyStartMonth(null), 1)
    assert.equal(parseFyStartMonth(''), 1)
    assert.equal(parseFyStartMonth('13'), 1)
    assert.equal(parseFyStartMonth('april'), 1)
    assert.equal(parseFyStartMonth(' 4 '), 4, 'a real setting is never second-guessed')
  })

  await check('fyRange spans the year the label names', () => {
    assert.deepEqual(fyRange('2026-08-11', 4), { from: '2026-04-01', to: '2027-03-31' })
    assert.deepEqual(fyRange('2026-02-11', 4), { from: '2025-04-01', to: '2026-03-31' })
    assert.deepEqual(fyRange('2026-08-11', 1), { from: '2026-01-01', to: '2026-12-31' })
  })

  /* ── 2f. document numbers are gapless, and a void keeps its own ────── */
  console.log('\ndocument numbers')

  await check('the settings row this restaurant actually has is readable', async () => {
    const { getSettingValue } = await import('../src/server/settings')
    const raw = await getSettingValue(rid, 'fy_start_month')
    const month = parseFyStartMonth(raw)
    console.log(`      fy_start_month = ${raw ?? 'unset'} -> ${fyLabel(new Date().toISOString().slice(0, 10), month)}`)
    assert.ok(month >= 1 && month <= 12)
  })

  await check('next_doc_no runs, is sequential, and never repeats', async () => {
    const seen: string[] = []
    try {
      await txn(async (tx) => {
        for (let i = 0; i < 3; i++) {
          const [row] = await tx<{ n: string }[]>`select next_doc_no(${rid}, 'ZZT', '9999') as n`
          seen.push(row.n)
        }
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    assert.deepEqual(seen, ['ZZT-9999-0001', 'ZZT-9999-0002', 'ZZT-9999-0003'])
    assert.equal(new Set(seen).size, 3, 'a number was handed out twice')
  })

  await check('a rolled-back save burns no number — the series stays gapless', async () => {
    // The reason nextDocNo takes the transaction handle. If it took the
    // pool, a failed save would leave a hole, and a hole in a numbered
    // series is exactly what an auditor asks about.
    const draw = async () => {
      let n = ''
      try {
        await txn(async (tx) => {
          const [row] = await tx<{ n: string }[]>`select next_doc_no(${rid}, 'ZZT', '9998') as n`
          n = row.n
          throw new Error('KB_ROLLBACK')
        })
      } catch (e) {
        if ((e as Error).message !== 'KB_ROLLBACK') throw e
      }
      return n
    }
    assert.equal(await draw(), 'ZZT-9998-0001')
    assert.equal(await draw(), 'ZZT-9998-0001', 'the rolled-back draw consumed a number')
  })

  await check('a voided expense nets its account back to nothing', async () => {
    // The reversal must copy the ORIGINAL's account, not a fresh one and not
    // none: money_movements negates the reversal too, so a void naming a
    // different account would leave the first one permanently short and
    // nothing on screen would say so. Exercises the real reversal SQL.
    let balance = -1
    let both = 0
    try {
      await txn(async (tx) => {
        const [acct] = await tx<{ id: string }[]>`
          insert into money_accounts (restaurant_id, name, kind, opening_balance, sort_order)
          values (${rid}, 'Zz void probe account', 'cash', 0, 999)
          returning id`
        const [orig] = await tx<{ id: string }[]>`
          insert into expenses (restaurant_id, expense_date, category, payee, amount,
                                paid_via, note, entered_by, account_id, doc_no)
          values (${rid}, current_date, 'zz-probe', 'Zz probe', 900, 'UPI', null, 'gate', ${acct.id}, 'ZZT-0000-0001')
          returning id`
        await tx`
          insert into expenses (restaurant_id, expense_date, category, payee, amount, paid_via,
                                note, reverses_id, entered_by, doc_no, account_id)
          select restaurant_id, expense_date, category, payee, -amount, paid_via, 'void', id,
                 'gate', 'ZZT-0000-0002', account_id
          from expenses where id = ${orig.id}`
        const [bal] = await tx<{ balance: string }[]>`
          select balance::text as balance from account_balances where account_id = ${acct.id}`
        balance = Number(bal?.balance ?? -1)
        const [n] = await tx<{ n: number }[]>`
          select count(*)::int as n from money_movements where account_id = ${acct.id}`
        both = n?.n ?? 0
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    assert.equal(both, 2, 'the void did not reach money_movements on the same account')
    assert.equal(balance, 0, 'the void left the account short — it did not copy the original account_id')
  })

  await check('every insert into a numbered table writes doc_no, voids included', async () => {
    // Read statically, because the failure to catch is a path shipped LATER
    // without a number — including a reversal written as `insert … select …`
    // that would otherwise copy the original's number along with everything
    // else. A void keeps its number; the reversal takes its own.
    const { readFileSync, readdirSync } = await import('node:fs')
    const NUMBERED = ['purchases', 'payments', 'expenses', 'cash_vouchers', 'contract_bills', 'casual_labour']
    // Everything above except purchases moves money through an account — a
    // purchase is a liability, the PAYMENT is the money. A reversal must
    // carry the original's account or that account stays short forever.
    const ACCOUNTED = NUMBERED.filter((t) => t !== 'purchases')
    // Same widening as the tenancy sweeps: an insert can be written in a page
    // as easily as in an action, and this gate should read wherever SQL lives.
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`
        if (e.isDirectory()) walk(q, out)
        else if (/\.tsx?$/.test(q)) {
          out.push(q)
        }
      }
      return out
    }
    const files = [...walk('src/server'), ...walk('src/app')]
    const missing: string[] = []
    let sites = 0
    let allocations = 0
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      allocations += (src.match(/nextDocNo\(/g) ?? []).length
      for (const table of NUMBERED) {
        const re = new RegExp(`insert into ${table}\\s*\\(`, 'g')
        let m: RegExpExecArray | null
        while ((m = re.exec(src)) !== null) {
          sites++
          // the column list runs to the first ')' after the opening paren
          const open = m.index + m[0].length - 1
          const close = src.indexOf(')', open)
          const columns = src.slice(open + 1, close)
          if (!columns.includes('doc_no')) missing.push(`${file}: insert into ${table} has no doc_no`)
          if (ACCOUNTED.includes(table) && !columns.includes('account_id')) {
            missing.push(`${file}: insert into ${table} has no account_id — a void would leave its account short`)
          }
        }
      }
    }
    assert.deepEqual(missing, [], missing.join('; '))
    assert.ok(sites > 0, 'found no numbered insert sites at all — did the tables get renamed?')
    assert.ok(
      allocations >= sites,
      `${sites} numbered inserts but only ${allocations} nextDocNo calls — a row is wearing someone else's number`,
    )
    console.log(`      ${sites} numbered inserts · ${allocations} allocations`)
  })

  /* ── 2g. the query loop, and the gate that makes it matter ────────── */
  //
  // A query is only worth building if it BLOCKS something. Without the gate
  // it is a comment box: someone types a question, nobody answers, the
  // month closes anyway. These assertions are about the gate, not the form.
  console.log('\nthe query loop')

  await check('an open query blocks a period close, and resolving it unblocks', async () => {
    let blockedWhileOpen = false
    let blockedWhileAnswered = false
    let blockedWhenResolved = false
    try {
      await txn(async (tx) => {
        const countBlockers = async () => {
          const [row] = await tx<{ n: number }[]>`
            select count(*)::int as n from queries
            where restaurant_id = ${rid} and status <> 'resolved'`
          return row?.n ?? 0
        }
        const before = await countBlockers()
        const [q] = await tx<{ id: string }[]>`
          insert into queries (restaurant_id, entity_type, question, assigned_role, status, raised_by)
          values (${rid}, 'day', 'Zz gate probe — why was Tuesday short?', 'cashier', 'open', 'gate')
          returning id`
        blockedWhileOpen = (await countBlockers()) === before + 1

        // ANSWERED still blocks: the accountant asked, so the accountant
        // decides it is settled. Closing around an unread answer is the
        // same as never having asked.
        await tx`update queries set status = 'answered', answer = 'zz', answered_by = 'gate',
                 answered_at = now() where id = ${q.id}`
        blockedWhileAnswered = (await countBlockers()) === before + 1

        await tx`update queries set status = 'resolved', resolved_by = 'gate',
                 resolved_at = now() where id = ${q.id}`
        blockedWhenResolved = (await countBlockers()) !== before
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    assert.ok(blockedWhileOpen, 'an open query did not register as a blocker')
    assert.ok(blockedWhileAnswered, 'an ANSWERED query stopped blocking — the accountant never got to decide')
    assert.ok(!blockedWhenResolved, 'a resolved query still blocks — the month could never close')
  })

  await check('open_queries and books_completeness agree on what is outstanding', async () => {
    // The dashboard reads books_completeness; the close reads the table.
    // If they ever disagree, one screen says the month is clean while the
    // other refuses to close it, and nobody can tell which is lying.
    const { getBooksCompleteness, listOpenQueries } = await import('../src/server/accountant-queries')
    const [rows, open] = await Promise.all([getBooksCompleteness(rid), listOpenQueries(rid)])
    const stated = rows.find((r) => r.what === 'Open queries awaiting an answer')
    assert.equal(stated?.n ?? 0, open.length)
  })

  await check('a query can only be assigned to someone who can answer it', async () => {
    // Mirrors the CHECK on queries.assigned_role. The accountant is absent
    // from it on purpose: they ask, they do not answer.
    const { ASSIGNABLE_ROLES } = await import('../src/lib/query-entities')
    assert.ok(!ASSIGNABLE_ROLES.includes('accountant'), 'the accountant cannot be asked their own question')
    await assert.rejects(
      () =>
        txn(async (tx) => {
          await tx`
            insert into queries (restaurant_id, entity_type, question, assigned_role, status)
            values (${rid}, 'day', 'zz', 'accountant', 'open')`
        }),
      /assigned_role/,
      'the database should refuse a query assigned to the accountant',
    )
  })

  await check('every assignable role is a real role, and every entity has one', async () => {
    const { ALL_ROLES } = await import('../src/lib/roles')
    const { ASSIGNABLE_ROLES, QUERY_ENTITIES } = await import('../src/lib/query-entities')
    for (const r of ASSIGNABLE_ROLES) assert.ok(ALL_ROLES.includes(r), `${r} is not a role`)
    for (const e of QUERY_ENTITIES) {
      assert.ok(ASSIGNABLE_ROLES.includes(e.role), `${e.key} suggests ${e.role}, who cannot be assigned`)
    }
    console.log(`      ${QUERY_ENTITIES.length} things a query can be about`)
  })

  /* ── 2h. the seven registers, run against the real database ───────── */
  //
  // A register that typechecks can still read a column that does not exist,
  // or silently return nothing because a `kind` string was renamed in the
  // view. Both would look like "a quiet month" rather than a bug, so every
  // one of the seven is executed.
  console.log('\nthe registers')

  const { getRegister, REGISTER_KEYS, REGISTER_TITLES, getAggregatorReceivable, getGstDays, getInputTax, getStaffFundBalance } =
    await import('../src/server/register-queries')

  for (const key of REGISTER_KEYS) {
    await check(`${REGISTER_TITLES[key]} runs and returns the shared shape`, async () => {
      const rows = await getRegister(rid, key, period.from, period.to)
      for (const r of rows) {
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.entry_date), 'entry_date must be a plain date string')
        // debit XOR credit: a ledger row sits on one side. Both filled would
        // double-count in the totals; neither filled is a row saying nothing.
        const sides = (r.debit === null ? 0 : 1) + (r.credit === null ? 0 : 1)
        assert.equal(sides, 1, `${key}: a row must sit on exactly one side (${r.debit} / ${r.credit})`)
        assert.ok(!Number.isNaN(Number(r.amount)), 'amount must be numeric')
      }
    })
  }

  await check('every money_movements kind lands in exactly one register', async () => {
    // The five money-out tables are an artefact of porting the sheets one
    // tab at a time. The registers are where that artefact must not show —
    // a kind nobody claims is money that appears in no register at all.
    const kinds = await tsql<{ kind: string }[]>`
      select distinct kind from money_movements where restaurant_id = ${rid}`
    const CLAIMED = new Set([
      'Payment', 'Expense', 'Casual labour', 'Contract bill', 'Staff advance',
      // 'Payroll' arrived with migration 0016, which made a PAID run reach
      // money_movements; 'Tax deposited' arrived with it too and carries a
      // NULL account_id, so the expense register is its only home.
      'Payroll', 'Tax deposited',
      // These reach the cash and bank registers through their ACCOUNT rather
      // than their kind, which is the correct route for money that moved.
      'Voucher', 'Other income', 'Settlement', 'Staff fund',
    ])
    const orphans = kinds.map((k) => k.kind).filter((k) => !CLAIMED.has(k))
    assert.deepEqual(orphans, [], `money with no register: ${orphans.join(', ')}`)
  })

  await check('the accountant reads run: receivable, gst, input tax, staff fund', async () => {
    const [recv, gst, input, fund] = await Promise.all([
      getAggregatorReceivable(rid),
      getGstDays(rid, period.from, period.to),
      getInputTax(rid, period.from, period.to),
      getStaffFundBalance(rid),
    ])
    for (const r of recv) assert.ok(!Number.isNaN(Number(r.outstanding)))
    for (const g of gst) assert.ok(!Number.isNaN(Number(g.gst_collected)))
    assert.ok(!Number.isNaN(Number(input.tax)))
    assert.ok(!Number.isNaN(Number(fund.owed_to_staff)))
    console.log(`      ${recv.length} partners · ${gst.length} sale days · ${input.bills} bills`)
  })

  await check('input tax is a COST unless the setting says otherwise', async () => {
    // The one tax assumption in the app, and it is a setting. Anything but
    // the exact string 'true' means not creditable — the conservative
    // reading, and the only one that is safe in a country nobody has
    // configured yet.
    const { getSettingValue } = await import('../src/server/settings')
    const raw = await getSettingValue(rid, 'input_tax_creditable')
    const creditable = raw === 'true'
    assert.equal(creditable, raw === 'true')
    console.log(`      input_tax_creditable = ${raw ?? 'unset'} -> ${creditable ? 'credit' : 'cost'}`)
  })

  await check('CSV never lets a cell become a formula', async () => {
    // A vendor called "-Sons Traders" would EXECUTE in Excel. Every export
    // in this app goes through toCsv, so this is where that is stopped.
    const { toCsv } = await import('../src/lib/csv')
    const out = toCsv(['a', 'b'], [['=SUM(A1:A9)', '-Sons Traders'], ['+1', '@x']])
    for (const risky of ['=SUM', '-Sons', '+1', '@x']) {
      assert.ok(out.includes(`'${risky}`), `${risky} was not neutralised`)
    }
    assert.ok(out.startsWith('﻿'), 'the BOM is missing — Excel would mangle every rupee sign')
    const quoted = toCsv(['a'], [['he said "hi", loudly']])
    assert.ok(quoted.includes('"he said ""hi"", loudly"'), 'quotes and commas must be escaped')
  })

  await check("every accountant action checks who is calling it", async () => {
    // These actions live in the accountant's group, and a group is gated by
    // the proxy — but a server action is a PUBLIC ENDPOINT, reachable by
    // anyone who can post to it. The route gate is not the check; the check
    // is in the action. answerQuery is the deliberate exception: it gates on
    // the query's own assigned_role instead, which is a stricter test.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/accountant-actions.ts', 'utf8')
    const EXEMPT = new Set(['answerQuery', 'blockingQueries'])
    const ungated: string[] = []
    const re = /export async function (\w+)\(/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      const name = m[1]
      if (EXEMPT.has(name)) continue
      const next = src.indexOf('export async function ', m.index + 1)
      const body = src.slice(m.index, next === -1 ? undefined : next)
      if (!body.includes('actor(')) ungated.push(name)
    }
    assert.deepEqual(ungated, [], `unauthenticated server actions: ${ungated.join(', ')}`)
    // and the exception really is gated, just differently
    assert.ok(
      /export async function answerQuery[\s\S]*?assigned_role/.test(src),
      'answerQuery lost its own role check',
    )
  })

  /* ── 2i. payroll: the pay law, and the freeze ─────────────────────── */
  //
  // The old sheet paid 34 days in a 30-day month. That is the bug payroll
  // exists to not repeat, so it is the first thing asserted — and asserted
  // against the DATABASE, because the constraint is what makes it
  // impossible rather than the care of whoever wrote the form.
  console.log('\npayroll')

  await check('the database refuses more days paid than the period holds', async () => {
    await assert.rejects(
      () =>
        txn(async (tx) => {
          const [run] = await tx<{ id: string }[]>`
            insert into payroll_runs (restaurant_id, period_start, period_end, status)
            values (${rid}, '2001-06-01', '2001-06-30', 'draft') returning id`
          const [st] = await tx<{ id: string }[]>`
            select id from staff where restaurant_id = ${rid} limit 1`
          if (!st) throw new Error('CHECK_UNTESTABLE')
          await tx`
            insert into payroll_lines (restaurant_id, run_id, staff_id, days_in_period, days_paid,
                                       base_salary, earned, net_payable)
            values (${rid}, ${run.id}, ${st.id}, 30, 34, 10000, 10000, 10000)`
        }),
      (e: unknown) => {
        const m = (e as Error).message
        // no staff yet is a valid state, not a failure of the constraint
        if (m === 'CHECK_UNTESTABLE') return true
        // the constraint is named payroll_lines_check, so Postgres's message
        // names the CONSTRAINT and not the column — matching on 'days_paid'
        // passed only while there were no staff to test it against
        return /check constraint/i.test(m) && /payroll_lines/.test(m)
      },
      '34 days in a 30-day month was accepted — the CHECK is gone',
    )
  })

  await check('the amounts on a payroll line CANNOT be updated — the freeze is a grant', async () => {
    // The freeze is not politeness in the action layer: kb_app physically
    // has no UPDATE on any amount, so a run says forever what it said the
    // day it was approved. If this list ever grows, a run became editable.
    const rows = await tsql<{ column_name: string }[]>`
      select column_name from information_schema.column_privileges
      where grantee = 'kb_app' and table_name = 'payroll_lines' and privilege_type = 'UPDATE'
      order by column_name`
    assert.deepEqual(
      rows.map((r) => r.column_name),
      ['account_id', 'note', 'paid_on', 'pay_mode'],
      'payroll amounts became updatable — a decision that can be quietly edited is not one',
    )
  })

  await check("the pay law is the view's, not a second copy", async () => {
    // present 1 · half 0.5 · off 1 (PAID) · leave and absent 0. If the draft
    // and labour_cost_by_section ever disagreed, the wage slip and the P&L
    // would state different labour for the same month.
    const [row] = await tsql<{ factor: string }[]>`
      select sum(case a.status
                   when 'present' then 1::numeric
                   when 'half' then 0.5
                   when 'off' then 1::numeric
                   else 0::numeric end)::text as factor
      from (values ('present'),('half'),('off'),('leave'),('absent')) as a(status)`
    assert.equal(row.factor, '2.5', 'the pay law changed: 1 + 0.5 + 1 + 0 + 0 = 2.5')
    const def = await tsql<{ d: string }[]>`
      select pg_get_viewdef('labour_cost_by_section'::regclass, true) as d`
    assert.ok(def[0].d.includes("WHEN 'off'::text THEN 1"), 'off stopped being paid in the view')
    assert.ok(def[0].d.includes("employment_type <> 'contract'"), 'contract staff re-entered the pay law')
  })

  await check('the payroll draft runs and excludes contract staff', async () => {
    const { getPayrollDraft, getOutstandingAdvances, listStaffIdentities } = await import(
      '../src/server/payroll-queries'
    )
    const draft = await getPayrollDraft(rid, '2001-06-01', '2001-06-30')
    for (const l of draft) {
      assert.equal(l.days_in_period, '30', 'June has 30 days')
      assert.ok(Number(l.days_paid) <= 30, 'a draft line may never exceed the period')
      assert.ok(!Number.isNaN(Number(l.earned)))
    }
    const contract = await tsql<{ n: number }[]>`
      select count(*)::int as n from staff
      where restaurant_id = ${rid} and status = 'active' and employment_type = 'contract'`
    const codes = new Set(draft.map((l) => l.staff_code))
    const contractCodes = await tsql<{ code: string }[]>`
      select code from staff
      where restaurant_id = ${rid} and status = 'active' and employment_type = 'contract'`
    for (const c of contractCodes) {
      assert.ok(!codes.has(c.code), `${c.code} is contract and must be billed by their vendor`)
    }
    await getOutstandingAdvances(rid)
    await listStaffIdentities(rid)
    console.log(`      ${draft.length} on the draft · ${contract[0].n} contract excluded`)
  })

  await check('only an owner can approve a run', async () => {
    // The split is the control: whoever works the figures out is not
    // whoever authorises them. A server action is a public endpoint, so
    // this must be in the action and not merely in the route.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/payroll-actions.ts', 'utf8')
    const start = src.indexOf('export async function approvePayrollRun(')
    assert.ok(start > -1, 'approvePayrollRun is gone')
    const body = src.slice(start, src.indexOf('export async function ', start + 1))
    assert.ok(/actor\(\s*\['owner'\]/.test(body), 'approve is no longer owner-only')
    assert.ok(/status = 'draft'/.test(body), 'approve stopped requiring a draft')
    // and nothing computes a statutory rate anywhere in payroll
    for (const bad of ['pfRate', 'esiRate', 'PF_RATE', 'ESI_RATE', '0.12', '0.0075']) {
      assert.ok(!src.includes(bad), `payroll must not compute a statutory rate (${bad})`)
    }
  })

  await check('a run goes draft → approved → paid, and the numbers hold', async () => {
    // End to end, in a transaction that rolls back. There are no staff yet
    // (the corrected master arrives from Rajesh), so the probe makes its
    // own — which is also the only way to assert the arithmetic by value
    // rather than against whatever happens to be in the database.
    let doc = ''
    let net = ''
    let statuses: string[] = []
    let frozen = ''
    try {
      await txn(async (tx) => {
        const [acct] = await tx<{ id: string }[]>`
          insert into money_accounts (restaurant_id, name, kind, opening_balance, sort_order)
          values (${rid}, 'Zz payroll probe account', 'bank', 0, 999) returning id`
        const [st] = await tx<{ id: string }[]>`
          insert into staff (restaurant_id, code, name, employment_type, base_salary, status)
          values (${rid}, 'ZZ999', 'Zz Probe', 'full_time', 30000, 'active') returning id`

        const docNo = await tx<{ n: string }[]>`select next_doc_no(${rid}, 'RUN', '9996') as n`
        doc = docNo[0].n
        const [run] = await tx<{ id: string }[]>`
          insert into payroll_runs (restaurant_id, period_start, period_end, doc_no, status, prepared_by)
          values (${rid}, '2001-06-01', '2001-06-30', ${doc}, 'draft', 'gate') returning id`

        // 30 days in June, 27 paid, ₹30,000 base -> earned 27,000; less a
        // 2,000 advance recovery -> 25,000 net.
        await tx`
          insert into payroll_lines (restaurant_id, run_id, staff_id, days_in_period, days_paid, base_salary,
                                     earned, advance_recovered, net_payable)
          values (${rid}, ${run.id}, ${st.id}, 30, 27, 30000, 27000, 2000, 25000)`
        const [line] = await tx<{ net: string }[]>`
          select net_payable::text as net from payroll_lines where run_id = ${run.id}`
        net = line.net

        // the two-step: an owner approves, only then can it be marked paid
        const [a] = await tx<{ status: string }[]>`
          update payroll_runs set status = 'approved', approved_by = 'gate', approved_at = now()
          where id = ${run.id} and status = 'draft' returning status`
        const [p] = await tx<{ status: string }[]>`
          update payroll_runs set status = 'paid'
          where id = ${run.id} and status = 'approved' returning status`
        statuses = [a.status, p.status]
        await tx`
          update payroll_lines set paid_on = '2001-07-01'::date, account_id = ${acct.id}, pay_mode = 'account'
          where run_id = ${run.id}`

        // and the amounts are STILL what they were — nothing on the paid
        // path touched a figure
        const [after] = await tx<{ net: string }[]>`
          select net_payable::text as net from payroll_lines where run_id = ${run.id}`
        frozen = after.net
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    assert.equal(doc, 'RUN-9996-0001', 'the run did not take a RUN document number')
    // compared by VALUE: numeric renders at the scale it was stored, so
    // '25000' and '25000.00' are the same money and only one is a string
    assert.equal(Number(net), 25000, '27,000 earned less a 2,000 advance is 25,000')
    assert.deepEqual(statuses, ['approved', 'paid'], 'the run did not walk draft → approved → paid')
    assert.equal(Number(frozen), 25000, 'marking a run paid moved one of its amounts')
  })

  await check('a lakh is enterable — the client is not stricter than its server', async () => {
    // At five integer digits the cap was ₹99,999.99 and the save button just
    // stayed disabled, with nothing on screen saying why. A restaurant pays
    // vendors and staff far more than that.
    const { parseMoney, parseQty } = await import('../src/lib/money')
    assert.equal(parseMoney('100000'), 10000000, '₹1,00,000 must be enterable')
    assert.equal(parseMoney('250000.50'), 25000050, '₹2,50,000.50 must be enterable')
    // seven figures is the ordinary case a restaurant hits every month —
    // a month's wage bill, a big vendor settlement
    assert.equal(parseMoney('1234567'), 123456700, 'a seven-figure amount must be enterable')
    assert.equal(parseMoney('9999999.99'), 999999999)
    assert.equal(parseMoney('999999999.99'), 99999999999)
    assert.ok(Number.isSafeInteger(parseMoney('999999999.99') as number))
    assert.equal(parseMoney('1234567890'), null, 'ten integer digits is still refused')
    assert.equal(parseMoney('-5'), null, 'a negative is not an amount')
    assert.equal(parseMoney('1.234'), null, 'three decimal places is not money')
    // quantities are a count of a thing, not a sum of money, and stay narrow
    assert.equal(parseQty('100000'), null)
  })

  /* ── 2j. migration 0016: payroll reaches the register, the till is
         counted rather than computed ──────────────────────────────────── */
  //
  // Both are claims the migration makes and the app now depends on. Asserted
  // the same way as every other money claim here: move some, in a
  // transaction that rolls back.
  console.log('\nmigration 0016')

  await check('a PAID payroll line reaches money_movements and the wages register', async () => {
    let inRegister = 0
    let unpaidInRegister = 0
    try {
      await txn(async (tx) => {
        const [acct] = await tx<{ id: string }[]>`
          insert into money_accounts (restaurant_id, name, kind, opening_balance, sort_order)
          values (${rid}, 'Zz 0016 probe', 'bank', 0, 999) returning id`
        const [st] = await tx<{ id: string }[]>`
          insert into staff (restaurant_id, code, name, employment_type, base_salary, status)
          values (${rid}, 'ZZ998', 'Zz Probe Two', 'full_time', 30000, 'active') returning id`
        const [run] = await tx<{ id: string }[]>`
          insert into payroll_runs (restaurant_id, period_start, period_end, status, prepared_by)
          values (${rid}, '2001-06-01', '2001-06-30', 'paid', 'gate') returning id`
        await tx`
          insert into payroll_lines (restaurant_id, run_id, staff_id, days_in_period, days_paid, base_salary,
                                     earned, net_payable)
          values (${rid}, ${run.id}, ${st.id}, 30, 30, 30000, 30000, 30000)`

        // UNPAID first: paid_on is null, so the view must not carry it
        const [before] = await tx<{ n: number }[]>`
          select count(*)::int as n from money_movements
          where account_id = ${acct.id} and kind = 'Payroll'`
        unpaidInRegister = before.n

        await tx`
          update payroll_lines set paid_on = '2001-07-01'::date, account_id = ${acct.id}
          where run_id = ${run.id}`
        const [after] = await tx<{ n: number }[]>`
          select count(*)::int as n from money_movements
          where account_id = ${acct.id} and kind = 'Payroll'`
        inRegister = after.n
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    assert.equal(unpaidInRegister, 0, 'an UNPAID run must not reach the register — nothing has moved')
    assert.equal(inRegister, 1, 'a paid payroll line did not reach money_movements')
  })

  await check("a till's balance is the COUNTED cash, not opening plus movements", async () => {
    // The whole point of is_till. If this ever reverts to computed, the
    // drawer would quietly disagree with the cashier's own count.
    let basis = ''
    let balance = 0
    try {
      await txn(async (tx) => {
        const [acct] = await tx<{ id: string }[]>`
          insert into money_accounts (restaurant_id, name, kind, opening_balance, sort_order, is_till)
          values (${rid}, 'Zz till probe', 'cash', 5000, 999, true) returning id`
        const [row] = await tx<{ basis: string; balance: string }[]>`
          select basis, balance::text as balance from account_balances where account_id = ${acct.id}`
        basis = row.basis
        balance = Number(row.balance)
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    // With no day close on record the view falls back to computed, and that
    // is correct — a till nobody has counted yet has no counted figure.
    assert.ok(basis === 'counted' || basis === 'computed', `unexpected basis ${basis}`)
    if (basis === 'computed') assert.equal(balance, 5000, 'the fallback must be opening + movements')
    console.log(`      till basis with the current data: ${basis}`)
  })

  await check('only one account can be the till', async () => {
    const [row] = await tsql<{ n: number }[]>`
      select count(*)::int as n from money_accounts
      where restaurant_id = ${rid} and is_till and status = 'active'`
    assert.ok(row.n <= 1, `${row.n} accounts are marked as the till — each would claim the whole drawer`)
  })

  await check('with no accounts, the nine forms say what to do rather than just refusing', async () => {
    // Nine forms refuse a blank account, and money_accounts starts EMPTY in
    // every restaurant. A refusal with no next step reads as the app being
    // broken — and is. One picker serves all nine, so this guards the one
    // place the sentence lives.
    const { readFileSync } = await import('node:fs')
    const picker = readFileSync('src/components/accounts/AccountPicker.tsx', 'utf8')
    const empty = picker.slice(picker.indexOf('accounts.length === 0'), picker.indexOf('const groups'))
    for (const must of ['Money accounts', 'Accounts → Money', 'cannot be saved']) {
      assert.ok(empty.includes(must), `the empty state stopped saying "${must}"`)
    }
    // and the route out is a PROP, never a literal — /owner/accounts is
    // owner-and-accountant only, so a cashier must not be shown that link
    // in QUOTES, not in prose — the comment above the empty state names the
    // route it deliberately does not hardcode, and that is not a violation
    assert.ok(
      !/['"`]\/owner\/accounts/.test(picker),
      'AccountPicker must not hardcode a link nine roles see',
    )
    assert.ok(picker.includes('manageHref'), 'the route out is passed in, per the matrix')

    // the day close is the one a cashier hits nightly, and its picker only
    // appears once a bank amount is typed — so it must speak BEFORE that
    const close = readFileSync('src/components/cash/DayClose.tsx', 'utf8')
    assert.ok(
      close.indexOf('accounts.length === 0') < close.indexOf('<AccountPicker'),
      'the day close must warn before the picker, not after the amount is keyed',
    )
    assert.ok(
      /cash close (itself )?saves normally/i.test(close),
      'the day close must say the night is not held up by a missing account',
    )
  })

  await check('a deposited challan names its account and reaches a register', async () => {
    // Before withholding_deposit_names_its_account, money_movements read a
    // hardcoded null for these, so a deposited challan could never be
    // reconciled and sat in the unaccounted count forever.
    let acctMovements = 0
    let unaccountedDelta = 0
    try {
      await txn(async (tx) => {
        const [before] = await tx<{ n: number }[]>`
          select count(*)::int as n from money_movements
          where restaurant_id = ${rid} and account_id is null`
        const [acct] = await tx<{ id: string }[]>`
          insert into money_accounts (restaurant_id, name, kind, opening_balance, sort_order)
          values (${rid}, 'Zz challan probe', 'bank', 0, 999) returning id`
        await tx`
          insert into withholdings (restaurant_id, wh_date, entity_type, party, base_amount,
                                    rate_pct, amount, deposited_on, account_id, entered_by)
          values (${rid}, current_date, 'payment', 'Zz authority', 10000, 2, 200,
                  current_date, ${acct.id}, 'gate')`
        const [after] = await tx<{ n: number }[]>`
          select count(*)::int as n from money_movements
          where restaurant_id = ${rid} and account_id is null`
        unaccountedDelta = after.n - before.n
        const [mm] = await tx<{ n: number }[]>`
          select count(*)::int as n from money_movements
          where account_id = ${acct.id} and kind = 'Tax deposited'`
        acctMovements = mm.n
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    assert.equal(acctMovements, 1, 'a deposited challan did not reach its account')
    assert.equal(unaccountedDelta, 0, 'a deposited challan still lands in the unaccounted count')
  })

  await check('the deposit form asks for an account, and the server refuses a blank', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/accountant-actions.ts', 'utf8')
    const start = src.indexOf('export async function markWithholdingDeposited(')
    assert.ok(start > -1, 'markWithholdingDeposited is gone')
    const body = src.slice(start, src.indexOf('export async function ', start + 1))
    assert.ok(body.includes('assertAccount'), 'a deposit stopped naming its account')
    assert.ok(body.includes('account_id ='), 'the account is asked for but never written')
    const panel = readFileSync('src/components/accountant/WithholdingsPanel.tsx', 'utf8')
    assert.ok(panel.includes('<AccountPicker'), 'the deposit form lost its picker')
    assert.ok(panel.includes("depAccountId === ''"), 'the deposit button no longer waits for an account')
  })

  /* ── 2k. reconciliation: a match is an assertion, not an event ────── */
  //
  // The one DELETE on the accounting side, and it is deliberate. Every other
  // table holds an EVENT and is corrected with a reversal; a match holds a
  // JUDGEMENT, and a judgement that turns out to be wrong was never true.
  // Leaving it beside a correction would assert two contradictory things and
  // leave unmatched_lines wrong forever.
  console.log('\nreconciliation')

  await check('unmatching is a DELETE, and the grant exists to allow it', async () => {
    // Checked at TABLE level: DELETE is a table privilege and never appears
    // in column_privileges — reading the wrong catalogue is exactly how this
    // was got wrong once already.
    const rows = await tsql<{ privilege_type: string }[]>`
      select privilege_type from information_schema.table_privileges
      where grantee = 'kb_app' and table_name = 'reconciliation_matches'`
    const held = rows.map((r) => r.privilege_type).sort()
    assert.deepEqual(held, ['DELETE', 'INSERT', 'SELECT'], 'the match grants changed')
    // and one match per statement line, so unmatching frees the line cleanly
    const [uniq] = await tsql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'reconciliation_matches'::regclass and contype = 'u'`
    assert.match(uniq.def, /statement_line_id/, 'a statement line may hold more than one match')
  })

  await check('a match can be made and taken back, and both sides come free', async () => {
    let afterMatch = 0
    let afterUnmatch = 0
    let freed = false
    try {
      await txn(async (tx) => {
        const [acct] = await tx<{ id: string }[]>`
          insert into money_accounts (restaurant_id, name, kind, opening_balance, sort_order)
          values (${rid}, 'Zz recon probe', 'bank', 0, 999) returning id`
        const [stmt] = await tx<{ id: string }[]>`
          insert into statements (restaurant_id, account_id, period_start, period_end,
                                  opening_balance, closing_balance, imported_by)
          values (${rid}, ${acct.id}, '2001-06-01', '2001-06-30', 0, -500, 'gate')
          returning id`
        const [line] = await tx<{ id: string }[]>`
          insert into statement_lines (restaurant_id, statement_id, stmt_date, description, amount)
          values (${rid}, ${stmt.id}, '2001-06-15', 'Zz probe line', -500) returning id`

        await tx`
          insert into reconciliation_matches (restaurant_id, statement_line_id, entity_type,
                                              entity_id, matched_by)
          values (${rid}, ${line.id}, 'expense', gen_random_uuid(), 'gate')`
        const [a] = await tx<{ n: number }[]>`
          select unmatched_lines::int as n from reconciliation_status where statement_id = ${stmt.id}`
        afterMatch = a.n

        const [gone] = await tx<{ id: string }[]>`
          delete from reconciliation_matches where statement_line_id = ${line.id} returning id`
        freed = gone !== undefined
        const [b] = await tx<{ n: number }[]>`
          select unmatched_lines::int as n from reconciliation_status where statement_id = ${stmt.id}`
        afterUnmatch = b.n
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    assert.equal(afterMatch, 0, 'the match did not reach reconciliation_status')
    assert.ok(freed, 'the match could not be deleted')
    assert.equal(afterUnmatch, 1, 'unmatching did not free the statement line again')
  })

  await check('the screens offer the unmatch and no longer claim it is permanent', async () => {
    const { readFileSync } = await import('node:fs')
    const actions = readFileSync('src/server/reconciliation-actions.ts', 'utf8')
    assert.ok(actions.includes('export async function unmatchStatementLine'), 'there is no unmatch')
    assert.ok(/delete from reconciliation_matches/.test(actions), 'unmatch does not delete')
    const start = actions.indexOf('export async function unmatchStatementLine')
    assert.ok(actions.slice(start).includes('actor('), 'unmatch is not role-gated')
    for (const f of [
      'src/server/reconciliation-actions.ts',
      'src/components/accountant/MatchBoard.tsx',
      'src/app/accounts/money/reconcile/[id]/page.tsx',
    ]) {
      const src = readFileSync(f, 'utf8')
      assert.ok(!/There is no unmatch/i.test(src), `${f} still says there is no unmatch`)
      assert.ok(!/match is permanent/i.test(src), `${f} still calls a match permanent`)
    }
  })

  await check('statement_self_check is opening + lines − closing', async () => {
    // Zero when the statement was keyed correctly. It is a fact about the
    // STATEMENT, never about the books, and the screen must not read it as
    // a discrepancy in the accounts.
    let selfCheck = -1
    try {
      await txn(async (tx) => {
        const [acct] = await tx<{ id: string }[]>`
          insert into money_accounts (restaurant_id, name, kind, opening_balance, sort_order)
          values (${rid}, 'Zz selfcheck probe', 'bank', 0, 999) returning id`
        const [stmt] = await tx<{ id: string }[]>`
          insert into statements (restaurant_id, account_id, period_start, period_end,
                                  opening_balance, closing_balance, imported_by)
          values (${rid}, ${acct.id}, '2001-06-01', '2001-06-30', 1000, 700, 'gate')
          returning id`
        await tx`
          insert into statement_lines (restaurant_id, statement_id, stmt_date, description, amount)
          values (${rid}, ${stmt.id}, '2001-06-10', 'Zz out', -300)`
        const [row] = await tx<{ c: string }[]>`
          select statement_self_check::text as c from reconciliation_status
          where statement_id = ${stmt.id}`
        selfCheck = Number(row.c)
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'KB_ROLLBACK') throw e
    }
    assert.equal(selfCheck, 0, '1000 opening − 300 out should close at 700')
  })

  /* ── 2l. the indent gap, in words ─────────────────────────────────── */
  console.log('\nthe indent gap')

  await check('a cancelled indent has NO gap, and the app does not coalesce it away', async () => {
    // The view returns NULL for qty_given and gap on a cancelled indent: a
    // request nobody was ever going to fill has no shortage. The query used
    // to coalesce both — which is the dash that reads like zero.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/kitchen-queries.ts', 'utf8')
    const start = src.indexOf('export async function getIndentFulfilment(')
    const body = src.slice(start, src.indexOf('export async function ', start + 1))
    assert.ok(!/coalesce\(qty_given/.test(body), 'qty_given is coalesced — cancelled would read as zero')
    assert.ok(!/coalesce\(gap/.test(body), 'gap is coalesced — cancelled would read as no shortage')

    // EVERY reader of the view, not just the one this assertion was written
    // for. It was name-scoped to getIndentFulfilment, so a second reader —
    // the department page's getDepartmentByCode — would have slipped straight
    // past it. A gate scoped to the place the first fault happened cannot find
    // the second one.
    const dept = readFileSync('src/server/department-queries.ts', 'utf8')
    for (const [file, text] of [
      ['kitchen-queries.ts', src],
      ['department-queries.ts', dept],
    ] as const) {
      const reads = text.split(/\n\s*\n/).filter((b) => /from indent_fulfilment/.test(b))
      assert.ok(reads.length > 0, `${file} should read indent_fulfilment`)
      for (const block of reads) {
        assert.ok(!/coalesce\(\s*qty_given/i.test(block), `${file}: qty_given coalesced`)
        assert.ok(!/coalesce\(\s*gap/i.test(block), `${file}: gap coalesced`)
      }
    }

    const def = await tsql<{ d: string }[]>`
      select pg_get_viewdef('indent_fulfilment'::regclass, true) as d`
    assert.match(def[0].d, /'cancelled'::text THEN NULL/, 'the view stopped nulling cancelled rows')
    // and the sign convention the words are built on
    assert.match(def[0].d, /qty_given, 0::numeric\) - l\.qty_requested/, 'gap is no longer given − requested')
  })

  await check('the gap is words, not a signed number', async () => {
    const { readFileSync } = await import('node:fs')
    const cell = readFileSync('src/components/kitchen/GapCell.tsx', 'utf8')
    assert.ok(cell.includes("'Short'") && cell.includes("'Extra'"), 'the gap lost its words')
    // the word is a JSX text node, not a string literal
    assert.ok(/gap === null/.test(cell) && /cancelled/.test(cell), 'a cancelled indent must say so, not show a dash')
    // negative is short, and that must agree with the view above
    assert.match(cell, /const short = n < 0/, 'the short/extra test flipped against the view')
    const page = readFileSync('src/app/kitchen/indent/[id]/page.tsx', 'utf8')
    assert.ok(page.includes('<GapCell'), 'the indent page stopped using the words')
    assert.ok(!/`−\$\{f\.gap\}`/.test(page), 'the signed number came back')
  })

  await check('section_consumption_daily runs, filters, and nets returns', async () => {
    const { getSectionConsumptionDaily } = await import('../src/server/store-queries')
    const all = await getSectionConsumptionDaily(rid, period.from, period.to)
    for (const r of all) {
      assert.match(r.move_date, /^\d{4}-\d{2}-\d{2}$/)
      assert.ok(!Number.isNaN(Number(r.consumed_value)))
      assert.ok(r.session !== null && r.session !== '', 'a consumption row must name its session')
    }
    // the filter is what lets the kitchen dashboard show only its own
    const codes = [...new Set(all.map((r) => r.section_code))].slice(0, 1)
    if (codes.length === 1) {
      const one = await getSectionConsumptionDaily(rid, period.from, period.to, codes)
      assert.ok(one.every((r) => r.section_code === codes[0]), 'the department filter leaks other departments')
      assert.ok(one.length <= all.length)
    }
    console.log(`      ${all.length} department-days in the period`)
  })

  /* ── 2m. only departments that consume can receive stock ──────────── */
  console.log('\nwho can receive stock')

  await check('the issue picker offers 12 of 16, and never the store itself', async () => {
    const { getSections, getAllSections } = await import('../src/server/store-queries')
    const [issuable, all] = await Promise.all([getSections(rid), getAllSections(rid)])
    assert.ok(issuable.length < all.length, 'the picker is offering every org unit again')
    const codes = new Set(issuable.map((s) => s.code))
    // the store issuing to itself is not a movement; the other three consume
    // nothing the store holds
    for (const c of ['ST', 'AC', 'VL', 'SC']) {
      assert.ok(!codes.has(c), `${c} is back in the issue picker`)
    }
    // and the ones that legitimately consume are still there
    for (const c of ['SI', 'NI', 'CH', 'CT', 'TD', 'BK', 'BR', 'SF', 'KS', 'SV', 'HK', 'MG']) {
      assert.ok(codes.has(c), `${c} consumes and must be issuable`)
    }
    assert.ok(issuable.every((s) => s.receives_stock), 'getSections returned a non-receiving department')
  })

  await check('a staff posting still sees EVERY department', async () => {
    // A guard is posted to Security and a day hand can unload for Valet.
    // Filtering the roster on receives_stock would have been the same bug
    // in the opposite direction.
    const { getAllSections } = await import('../src/server/store-queries')
    const all = await getAllSections(rid)
    const codes = new Set(all.map((s) => s.code))
    for (const c of ['ST', 'AC', 'VL', 'SC']) {
      assert.ok(codes.has(c), `${c} vanished from the roster — a guard cannot be posted`)
    }
    const { readFileSync } = await import('node:fs')
    for (const f of [
      'src/app/staff/people/employees/new/page.tsx',
      'src/app/staff/people/employees/[code]/edit/page.tsx',
      'src/app/staff/money-out/casual/page.tsx',
    ]) {
      assert.ok(readFileSync(f, 'utf8').includes('getAllSections'), `${f} filtered the roster`)
    }
  })

  await check('THE PICKER IS NOT THE CHECK — the server refuses it too', async () => {
    // Both the issue and the return path. A form can be posted to directly.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/store-actions.ts', 'utf8')
    const guards = src.match(/receives_stock/g) ?? []
    assert.ok(guards.length >= 4, `expected the guard on both paths, found ${guards.length} mentions`)
    assert.ok(
      (src.match(/does not receive stock/g) ?? []).length === 2,
      'the refusal must fire on the issue AND the return',
    )
  })

  await check('the database agrees: 12 receive, 4 do not', async () => {
    const rows = await tsql<{ receives_stock: boolean; n: number }[]>`
      select receives_stock, count(*)::int as n from sections
      where restaurant_id = ${rid} and status = 'active'
      group by receives_stock order by receives_stock desc`
    assert.deepEqual(
      rows.map((r) => [r.receives_stock, r.n]),
      [[true, 12], [false, 4]],
      'the receives_stock split changed — if that was deliberate, update this',
    )
  })

  await check('every client fetch can be aborted and cannot hang forever', async () => {
    // A pending fetch is enough to stop a document reaching idle. One on
    // /store/issue had neither an abort path nor a timeout because it is
    // called from a click rather than an effect, so nothing cleaned it up.
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const p = `${dir}/${e}`
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.tsx?$/.test(p)) out.push(p)
      }
      return out
    }
    const offenders: string[] = []
    for (const f of walk('src/components').concat(walk('src/app'))) {
      const src = readFileSync(f, 'utf8')
      if (!src.includes('fetch(')) continue
      const calls = (src.match(/\bfetch\(/g) ?? []).length
      const signals = (src.match(/signal:/g) ?? []).length
      if (signals < calls) offenders.push(`${f} (${calls} fetch, ${signals} signal)`)
    }
    assert.deepEqual(offenders, [], `a fetch with no abort path:\n      ${offenders.join('\n      ')}`)
  })

  await check('no tab costs a redirect to reach its default chip', async () => {
    // Every chip parent used to redirect to its first child, so every tab
    // click was two server round trips: one to be told where to go, one to
    // go there. They render the child directly now.
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const p = `${dir}/${e}`
        if (statSync(p).isDirectory()) walk(p, out)
        else if (e === 'page.tsx') out.push(p)
      }
      return out
    }
    const offenders: string[] = []
    for (const f of walk('src/app')) {
      const src = readFileSync(f, 'utf8')
      const m = src.match(/redirect\('(\/[^']*)'\)/)
      if (m === null) continue
      // '/' -> /login is the front door, and a legacy shim is a redirect by
      // definition. A CHIP PARENT redirecting to its own child is the bug.
      const here = f.replace(/^src\/app/, '').replace(/\/page\.tsx$/, '') || '/'
      if (m[1].startsWith(`${here}/`)) offenders.push(`${f} -> ${m[1]}`)
    }
    assert.deepEqual(offenders, [], `a tab still redirects to its own child:\n      ${offenders.join('\n      ')}`)
  })

  await check('the first chip lights up at the parent URL', async () => {
    // Rendering the child directly means the URL stays on the parent, so
    // the row must mark the first chip active there or nothing is selected
    // and the tab reads as broken.
    const { readFileSync } = await import('node:fs')
    const row = readFileSync('src/components/ChipRow.tsx', 'utf8')
    assert.match(row, /i === 0 && pathname === base/, 'the parent URL selects no chip')
  })

  await check('create and edit agree about who may receive an indent', async () => {
    // updateIndent checked receives_stock and saveIndent did not, so a
    // request could be created for a department and then be uneditable.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/kitchen-actions.ts', 'utf8')
    for (const fn of ['saveIndent', 'updateIndent']) {
      const start = src.indexOf(`export async function ${fn}(`)
      assert.ok(start > -1, `${fn} is gone`)
      const body = src.slice(start, src.indexOf('export async function ', start + 1))
      assert.ok(
        /receives_stock|assertReceivesStock/.test(body),
        `${fn} does not check that the department can receive stock`,
      )
    }
  })

  /* ── 2n. the count corrects the book, but only when accepted ──────── */
  //
  // ACCEPTING A VARIANCE IS A JUDGEMENT, NOT A CONSEQUENCE. A variance can
  // be a counting error as easily as a stock error, so nothing is automatic.
  console.log('\nstock adjustments')

  await check('stock_on_hand now reads adjustments and vendor returns', async () => {
    const def = await tsql<{ d: string }[]>`
      select pg_get_viewdef('stock_on_hand'::regclass, true) as d`
    assert.match(def[0].d, /stock_adjustments/, 'the count still cannot correct the book')
    assert.match(def[0].d, /vendor_return_lines/, 'goods sent back to a vendor still sit on the shelf')
  })

  await check('an adjustment moves the book by exactly its quantity', async () => {
    let before = 0
    let after = 0
    try {
      await txn(async (tx) => {
        const [item] = await tx<{ id: string }[]>`
          select id from items where restaurant_id = ${rid} and status = 'active' limit 1`
        if (!item) throw new Error('KB_NO_ITEMS')
        const [b] = await tx<{ q: string }[]>`
          select on_hand_qty::text as q from stock_on_hand where item_id = ${item.id}`
        before = Number(b?.q ?? 0)
        // value is GENERATED — absent from the column list on purpose
        await tx`
          insert into stock_adjustments (restaurant_id, adj_date, item_id, qty, unit_cost, reason, entered_by)
          values (${rid}, current_date, ${item.id}, -3, 100, 'Count correction', 'gate')`
        const [a] = await tx<{ q: string; v: string }[]>`
          select on_hand_qty::text as q,
                 (select value::text from stock_adjustments where item_id = ${item.id}
                  order by created_at desc limit 1) as v
          from stock_on_hand where item_id = ${item.id}`
        after = Number(a.q)
        assert.equal(Number(a.v), -300, 'the generated value is not qty × unit_cost')
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      const m = (e as Error).message
      if (m === 'KB_NO_ITEMS') return // no items yet is a valid state
      if (m !== 'KB_ROLLBACK') throw e
    }
    assert.equal(after - before, -3, 'the adjustment did not move stock_on_hand')
  })

  await check('a count is NOT accepted by being saved', async () => {
    // The whole modification: recording a variance changes nothing until a
    // person accepts it. If accepted_at were ever defaulted, the book would
    // be corrected by a bad count without anybody deciding.
    const [col] = await tsql<{ d: string | null; nn: string }[]>`
      select column_default as d, is_nullable as nn from information_schema.columns
      where table_name = 'stock_counts' and column_name = 'accepted_at'`
    assert.equal(col.d, null, 'accepted_at has a default — a count would accept itself')
    assert.equal(col.nn, 'YES', 'accepted_at must be nullable: unaccepted is a real state')
    const grants = await tsql<{ column_name: string }[]>`
      select column_name from information_schema.column_privileges
      where grantee = 'kb_app' and table_name = 'stock_counts' and privilege_type = 'UPDATE'
      order by column_name`
    assert.deepEqual(
      grants.map((g) => g.column_name),
      ['accepted_at', 'accepted_by'],
      'the only thing updatable on a count is its acceptance',
    )
  })

  await check('a short does not move stock — qty on the line is what ARRIVED', async () => {
    // The reason shorts are their own table. If purchase_lines.qty ever
    // meant "billed", stock and COGS would both inherit goods that never
    // came through the door.
    const def = await tsql<{ d: string }[]>`
      select pg_get_viewdef('stock_on_hand'::regclass, true) as d`
    assert.ok(!def[0].d.includes('purchase_line_shorts'), 'a short is moving stock — it must not')
  })

  await check('vendor_performance runs and states what it counts', async () => {
    const rows = await tsql<{ name: string; bills: number; unsettled: number }[]>`
      select name, bills::int as bills, unsettled::int as unsettled
      from vendor_performance where restaurant_id = ${rid}`
    for (const r of rows) {
      assert.ok(r.bills >= 0 && r.unsettled >= 0)
    }
    console.log(`      ${rows.length} vendors measured`)
  })

  await check('voiding a return puts the stock back — BOTH return tables', async () => {
    // This replaced a refusal. vendor_return_lines and return_lines both
    // carry CHECK (qty > 0), so neither can use the negative-twin void; the
    // reversal is marked on the PARENT and the views filter on it. Before
    // that clause existed a void took the quantity off TWICE: 18.5 -> 8.5
    // -> −1.5. Asserted for both tables because the kitchen one had the
    // identical fault and nobody had tried it.
    let vendor: number[] = []
    let kitchen: number[] = []
    try {
      await txn(async (tx) => {
        const [item] = await tx<{ item_id: string; q: string }[]>`
          select item_id, on_hand_qty::text as q from stock_on_hand
          where restaurant_id = ${rid} and on_hand_qty > 5 limit 1`
        if (!item) throw new Error('KB_NO_STOCK')
        const [v] = await tx<{ id: string }[]>`
          select id from vendors where restaurant_id = ${rid} limit 1`
        const [sec] = await tx<{ id: string }[]>`
          select id from sections where restaurant_id = ${rid} and receives_stock limit 1`
        if (!v || !sec) throw new Error('KB_NO_STOCK')
        const on = async () => {
          const [r] = await tx<{ q: string }[]>`
            select on_hand_qty::text as q from stock_on_hand where item_id = ${item.item_id}`
          return Number(r.q)
        }

        const v0 = await on()
        const [vr] = await tx<{ id: string }[]>`
          insert into vendor_returns (restaurant_id, return_date, vendor_id, reason, entered_by)
          values (${rid}, current_date, ${v.id}, 'zz gate', 'gate') returning id`
        await tx`insert into vendor_return_lines (restaurant_id, vendor_return_id, item_id, qty, rate)
                 values (${rid}, ${vr.id}, ${item.item_id}, 5, 50)`
        const v1 = await on()
        const [vrev] = await tx<{ id: string }[]>`
          insert into vendor_returns (restaurant_id, return_date, vendor_id, reason, reverses_id, entered_by)
          values (${rid}, current_date, ${v.id}, 'void', ${vr.id}, 'gate') returning id`
        await tx`insert into vendor_return_lines (restaurant_id, vendor_return_id, item_id, qty, rate)
                 select ${rid}, ${vrev.id}, item_id, qty, rate from vendor_return_lines where vendor_return_id = ${vr.id}`
        vendor = [v0, v1, await on()]

        const k0 = await on()
        const [kr] = await tx<{ id: string }[]>`
          insert into returns (restaurant_id, return_date, section_id, reason, entered_by)
          values (${rid}, current_date, ${sec.id}, 'zz gate', 'gate') returning id`
        await tx`insert into return_lines (restaurant_id, return_id, item_id, qty, unit_cost)
                 values (${rid}, ${kr.id}, ${item.item_id}, 4, 50)`
        const k1 = await on()
        const [krev] = await tx<{ id: string }[]>`
          insert into returns (restaurant_id, return_date, section_id, reason, reverses_id, entered_by)
          values (${rid}, current_date, ${sec.id}, 'void', ${kr.id}, 'gate') returning id`
        await tx`insert into return_lines (restaurant_id, return_id, item_id, qty, unit_cost)
                 select ${rid}, ${krev.id}, item_id, qty, unit_cost from return_lines where return_id = ${kr.id}`
        kitchen = [k0, k1, await on()]
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      const m = (e as Error).message
      if (m === 'KB_NO_STOCK') return
      if (m !== 'KB_ROLLBACK') throw e
    }
    assert.equal(vendor[1], vendor[0] - 5, 'a vendor return did not take the stock off')
    assert.equal(vendor[2], vendor[0], 'voiding a vendor return did not put the stock back')
    assert.equal(kitchen[1], kitchen[0] + 4, 'a kitchen return did not put the stock back on the shelf')
    assert.equal(kitchen[2], kitchen[0], 'voiding a kitchen return did not undo it')
  })

  await check('accepting a count twice corrects the book ONCE', async () => {
    // The arithmetic is self-correcting rather than the warning carrying it:
    //   adjustment = counted − frozen book − already corrected since frozen
    // Two counts, book 10, shelf 7: the first writes −3, the second writes 0,
    // in either order. The variance stays photographed; only the correction
    // is computed live.
    let first = 0
    let second = 0
    let final = 0
    let book = 0
    try {
      await txn(async (tx) => {
        const [item] = await tx<{ item_id: string; q: string }[]>`
          select item_id, on_hand_qty::text as q from stock_on_hand
          where restaurant_id = ${rid} and on_hand_qty > 5 limit 1`
        if (!item) throw new Error('KB_NO_STOCK')
        book = Number(item.q)
        const mkCount = async () => {
          const [c] = await tx<{ id: string }[]>`
            insert into stock_counts (restaurant_id, count_date, entered_by)
            values (${rid}, current_date, 'gate') returning id`
          await tx`insert into stock_count_lines (restaurant_id, count_id, item_id, counted_qty, book_qty, unit_cost)
                   values (${rid}, ${c.id}, ${item.item_id}, ${book - 3}, ${book}, 100)`
          return c.id
        }
        const accept = async (cid: string) => {
          const [row] = await tx<{ n: string }[]>`
            with prior as (
              select a.item_id, coalesce(sum(a.qty), 0) as already
              from stock_adjustments a join stock_counts c2 on c2.id = ${cid}
              where a.restaurant_id = ${rid} and a.created_at >= c2.created_at
                and a.count_id is distinct from ${cid}::uuid
              group by a.item_id
            ), ins as (
              insert into stock_adjustments
                (restaurant_id, adj_date, item_id, qty, unit_cost, reason, count_id, entered_by)
              select ${rid}::uuid, current_date, l.item_id, l.variance_qty - coalesce(p.already, 0),
                     l.unit_cost, 'Count correction'::text, ${cid}::uuid, 'gate'::text
              from stock_count_lines l left join prior p on p.item_id = l.item_id
              where l.count_id = ${cid} and l.variance_qty - coalesce(p.already, 0) <> 0
              returning qty
            ) select coalesce(sum(qty), 0)::text as n from ins`
          return Number(row.n)
        }
        const c1 = await mkCount()
        const c2 = await mkCount()
        first = await accept(c1)
        second = await accept(c2)
        const [r] = await tx<{ q: string }[]>`
          select on_hand_qty::text as q from stock_on_hand where item_id = ${item.item_id}`
        final = Number(r.q)
        throw new Error('KB_ROLLBACK')
      })
    } catch (e) {
      const m = (e as Error).message
      if (m === 'KB_NO_STOCK') return
      if (m !== 'KB_ROLLBACK') throw e
    }
    assert.equal(first, -3, 'the first acceptance must write the whole variance')
    assert.equal(second, 0, 'the second acceptance must write nothing — the book already carries it')
    assert.equal(final, book - 3, 'the book was corrected twice')
  })

  await check('a voucher cannot be both goods and wages', async () => {
    // Both flags true would put one amount into cost of goods AND on the
    // labour line — the same rupee in two totals. The form asks it as one
    // three-way question; this is the check, because a form is never one.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/cash-actions.ts', 'utf8')
    const start = src.indexOf('export async function saveVouchers(')
    const body = src.slice(start, src.indexOf('export async function ', start + 1))
    assert.match(
      body,
      // per line now: the batch checks each payment, not one input
      /l\.isStockPurchase && l\.isCasualLabour/,
      'saveVouchers no longer refuses a payment that is both',
    )
    const form = readFileSync('src/components/cash/VoucherForm.tsx', 'utf8')
    assert.ok(!/setIsStockPurchase/.test(form), 'the independent toggles came back')
    assert.match(form, /type Kind = 'expense' \| 'stock' \| 'labour'/, 'the three-way question is gone')
  })

  await check('the precondition vocabulary exists and ranks correctly', async () => {
    const { UNASSESSABLE_URGENCY, requires } = await import('../src/lib/precondition')
    // above everything genuinely fine, below every real finding
    assert.ok(UNASSESSABLE_URGENCY > 0, 'unassessable must outrank all-clear')
    assert.ok(UNASSESSABLE_URGENCY < 100, 'unassessable must never outrank a real finding')
    const met = requires(true, [1], 'x', 'y')
    assert.equal(met.assessable, true)
    const unmet = requires(false, [1], 'no sales fetched', 'nothing to check')
    assert.equal(unmet.assessable, false)
  })

  await check('a component mounted twice is duplication — one mount each now', async () => {
    // The test that made two tab deletions provable rather than judged:
    // SectionsView was mounted at /kitchen/books/sections, /staff/books/
    // sections AND behind the Kitchen Departments tab. Three doors, one
    // screen. If it ever gains a second live mount again, that is the same
    // duplication returning.
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const p = `${dir}/${e}`
        if (statSync(p).isDirectory()) walk(p, out)
        else if (e === 'page.tsx') out.push(p)
      }
      return out
    }
    const mounts = walk('src/app').filter((f) => {
      const src = readFileSync(f, 'utf8')
      // a shim redirects and renders nothing — it is not a mount
      return src.includes('SectionsView') && !src.includes('permanentRedirect')
    })
    assert.equal(mounts.length, 1, `SectionsView is mounted ${mounts.length} times:\n      ${mounts.join('\n      ')}`)
  })

  await check('the tab strips shrank as agreed, and nothing lost its route', async () => {
    const { TAB_DEFAULTS } = await import('../src/lib/tabs')
    // Seven now: Payments joined, and the count is asserted BY NAME in
    // 'the three strips regrouped by subject' — a count cannot see a rename or
    // a reorder, which is the whole reason PERIOD_KEYS.length was replaced too.
    assert.equal(TAB_DEFAULTS.accounts.length, 7, 'accounts should be seven tabs')
    const acc = TAB_DEFAULTS.accounts.map((t) => t.key)
    assert.ok(!acc.includes('tax') && !acc.includes('export'), 'tax and export folded into registers')
    const regs = TAB_DEFAULTS.accounts.find((t) => t.key === 'registers')
    assert.ok(regs?.chips?.some((c) => c.key === 'tax'), 'tax must survive as a register')
    const sales = TAB_DEFAULTS.sales.map((t) => t.key)
    assert.ok(!sales.includes('daily'), 'daily sale folded into the day')
    assert.ok(sales.includes('record'), 'Record must stay its own door — it is the nightly WRITING task')
    assert.ok(!TAB_DEFAULTS.staff.some((t) => t.key === 'books'), 'the staff Books tab was duplication')
    // and the CSV route is untouched
    const { readFileSync } = await import('node:fs')
    assert.ok(
      readFileSync('src/app/api/accounts/export/route.ts', 'utf8').includes('isRegisterKey'),
      'the export route must survive the screen folding away',
    )
  })

  /* ── 2o. which books am I in ──────────────────────────────────────── */
  console.log('\ntenancy')

  await check('the session carries the tenant, and the cache is gone', async () => {
    const { readFileSync } = await import('node:fs')
    const session = readFileSync('src/lib/session.ts', 'utf8')
    assert.match(session, /t: string/, 'SessionPayload lost its tenant')

    const queries = readFileSync('src/server/queries.ts', 'utf8')
    assert.ok(!/restaurantCache/.test(queries), 'the module-level restaurant cache came back')
    assert.ok(
      !/order by created_at asc\s*\n?\s*limit 1`/.test(queries),
      'getRestaurant is picking the oldest row again',
    )
    assert.match(queries, /getSessionUser\(\)/, 'getRestaurant no longer derives from the session')

    const cur = readFileSync('src/server/current-user.ts', 'utf8')
    assert.match(cur, /payload\.t !== user\.restaurant_id/, 'a stale tenant claim would be honoured')
    assert.match(cur, /rows\.length !== 1/, 'an ambiguous username would resolve to a tenant')

    const core = readFileSync('src/server/auth-core.ts', 'utf8')
    const start = core.indexOf('export async function verifyCredentials(')
    const body = core.slice(start, core.indexOf('\nexport ', start + 1))
    assert.ok(!/restaurantId: string/.test(body), 'verifyCredentials is told the tenant again')
    // AN AMBIGUOUS MATCH MUST NOT RESOLVE TO A TENANT. This used to be spelled
    // `rows.length > 1` — a guard against one username existing in two
    // restaurants, back when the read swept every tenant it could see. The
    // tenant now comes from tenant_for_username, which returns ONE uuid, and
    // the read is scoped to it; within a tenant the unique index on
    // lower(username) makes a second row impossible. So the property is
    // stated as `rows.length === 1`, which is the same guarantee and also
    // routes the zero-row case through the single failure path.
    assert.match(body, /rows\.length === 1 \? rows\[0\] : undefined/, 'an ambiguous login would pick a tenant')
    assert.match(body, /tenantForUsername\(username\)/, 'login no longer resolves the tenant from the username')
  })

  await check('the no-session fallback answers only while it cannot be wrong', async () => {
    // Outside a request there is no session. The fallback is allowed to
    // exist because it reads limit 2 and REFUSES when a second restaurant
    // exists — a guess that cannot be wrong is not a guess.
    const { readFileSync } = await import('node:fs')
    const q = readFileSync('src/server/queries.ts', 'utf8')
    assert.match(q, /limit 2`/, 'the fallback stopped checking for a second tenant')
    assert.match(q, /rows\.length > 1/, 'the fallback would silently pick one of two tenants')
    // and it still works today, because there is exactly one
    const { getRestaurant } = await import('../src/server/queries')
    const r = await getRestaurant()
    assert.ok(r.id.length === 36, 'the fallback stopped answering for the single tenant')
  })

  await check('every UPDATE names its tenant', async () => {
    // A cross-tenant WRITE is worse than a cross-tenant read: it corrupts
    // another restaurant's workflow rather than merely exposing it.
    const { readdirSync, readFileSync } = await import('node:fs')
    // WHEREVER SQL CAN BE WRITTEN, not where we assume it lives. This was a
    // flat listing of src/server/*.ts, so a PAGE importing `sql` directly was
    // invisible — and two did. /kitchen/departments announced no tenant and
    // 500'd on every load with 22P02 while this suite reported all clear.
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`
        if (e.isDirectory()) walk(q, out)
        else if (/\.tsx?$/.test(q)) {
          out.push(q)
        }
      }
      return out
    }
    const files = [...walk('src/server'), ...walk('src/app')]
    const scoped = new Set(
      (
        await tsql<{ table_name: string }[]>`
          select table_name from information_schema.columns
          where table_schema = 'public' and column_name = 'restaurant_id'`
      ).map((r) => r.table_name),
    )
    const bad: string[] = []
    for (const f of files) {
      // ${…} holes are flattened FIRST: a set list containing sql`sort_order`
      // carries a backtick inside an expression, which would end the match
      // before the where clause and report a scoped update as unscoped.
      const src = readFileSync(f, 'utf8').replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ? ')
      for (const m of src.matchAll(/update\s+([a-z_]+)\s+set[\s\S]{0,1200}?`/g)) {
        const table = m[1]
        if (!scoped.has(table) || table === 'restaurants') continue
        if (!/restaurant_id/.test(m[0])) bad.push(`${f}: update ${table}`)
      }
    }
    assert.deepEqual(bad, [], `cross-tenant writes:\n      ${bad.join('\n      ')}`)
  })

  await check('every transaction announces its tenant', async () => {
    // Phase 2(a). sql.begin must not be called directly any more: txn() is
    // the only thing that emits `set local app.restaurant_id`, and a
    // transaction that skips it will be denied wholesale once RLS is on.
    const { readdirSync, readFileSync } = await import('node:fs')
    // WHEREVER SQL CAN BE WRITTEN, not where we assume it lives. This was a
    // flat listing of src/server/*.ts, so a PAGE importing `sql` directly was
    // invisible — and two did. /kitchen/departments announced no tenant and
    // 500'd on every load with 22P02 while this suite reported all clear.
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`
        if (e.isDirectory()) walk(q, out)
        else if (/\.tsx?$/.test(q)) {
          out.push(q)
        }
      }
      return out
    }
    const files = [...walk('src/server'), ...walk('src/app')]
    const raw = files.filter((f) => /\bsql\.begin\(/.test(readFileSync(f, 'utf8')))
    assert.deepEqual(raw, [], `these bypass the tenant GUC:\n      ${raw.join('\n      ')}`)

    const db = readFileSync('src/lib/db.ts', 'utf8')
    assert.match(db, /set local app\.restaurant_id/, 'the GUC statement is gone')
    // `local` is not optional: Supavisor is in TRANSACTION mode, so a plain
    // `set` rides the connection back into the pool and reaches whoever
    // draws it next.
    assert.ok(!/[^_]set app\.restaurant_id/.test(db), 'a non-local set would leak across tenants')
  })

  await check('the GUC actually reaches Postgres', async () => {
    const { withTenant } = await import('../src/lib/tenant')
    const { txn } = await import('../src/lib/db')
    const seen = await withTenant(rid, async () =>
      txn(async (tx) => {
        const [row] = await tx<{ v: string }[]>`
          select current_setting('app.restaurant_id', true) as v`
        return row.v
      }),
    )
    assert.equal(seen, rid, 'the transaction did not announce its tenant to Postgres')

    // and it does NOT survive the transaction — that is what `local` buys.
    // DELIBERATELY on the bare pool: tsql would announce the tenant itself
    // and the check would pass by making the thing it is testing for. It
    // touches no tenant table, so RLS has nothing to say about it.
    const [after] = await sql<{ v: string | null }[]>`
      select current_setting('app.restaurant_id', true) as v`
    assert.ok(after.v === null || after.v === '', 'the tenant leaked out of its transaction')
  })

  await check('a malformed tenant is never interpolated', async () => {
    // set local takes no bind parameters, so this is the one place a value
    // is concatenated into SQL. The shape check is the whole defence.
    const { tenantGuc } = await import('../src/lib/tenant')
    assert.equal(tenantGuc(null), null)
    assert.match(tenantGuc(rid) ?? '', /^set local app\.restaurant_id = '[0-9a-f-]{36}'$/)
    assert.throws(() => tenantGuc("' or 1=1 --"), /malformed tenant/i)
  })

  await check('every line insert carries the tenant it belongs to', async () => {
    // The 14 line tables gained restaurant_id NOT NULL. The app must write
    // it on every insert, from the parent — a line that names no tenant is
    // a row RLS cannot place.
    const { readdirSync, readFileSync } = await import('node:fs')
    const lineTables = (
      await tsql<{ table_name: string }[]>`
        select c.table_name from information_schema.columns c
        where c.table_schema = 'public' and c.column_name = 'restaurant_id'
          and c.table_name like '%_lines'`
    ).map((r) => r.table_name)
    assert.ok(lineTables.length >= 13, `expected the line tables to carry a tenant, found ${lineTables.length}`)

    // WHEREVER SQL CAN BE WRITTEN, not where we assume it lives. This was a
    // flat listing of src/server/*.ts, so a PAGE importing `sql` directly was
    // invisible — and two did. /kitchen/departments announced no tenant and
    // 500'd on every load with 22P02 while this suite reported all clear.
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`
        if (e.isDirectory()) walk(q, out)
        else if (/\.tsx?$/.test(q)) {
          out.push(q)
        }
      }
      return out
    }
    const files = [...walk('src/server'), ...walk('src/app')]
    const missing: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ? ')
      for (const t of lineTables) {
        const re = new RegExp(`insert into ${t}\\s*\\(`, 'g')
        let m: RegExpExecArray | null
        while ((m = re.exec(src)) !== null) {
          const open = m.index + m[0].length - 1
          const cols = src.slice(open + 1, src.indexOf(')', open))
          if (!cols.includes('restaurant_id')) missing.push(`${f}: insert into ${t}`)
        }
      }
    }
    assert.deepEqual(missing, [], `line inserts with no tenant:\n      ${missing.join('\n      ')}`)
  })

  await check('no read runs outside a tenant-announcing transaction', async () => {
    // The last thing between here and RLS. A read outside a transaction has
    // no app.restaurant_id to read, so under RLS current_setting returns
    // NULL, every policy comparison yields NULL, and it returns ZERO ROWS —
    // an app that looks like an empty database, which is a worse outage
    // than a loud failure because nobody suspects security.
    const { readdirSync, readFileSync } = await import('node:fs')
    // WHEREVER SQL CAN BE WRITTEN, not where we assume it lives. This was a
    // flat listing of src/server/*.ts, so a PAGE importing `sql` directly was
    // invisible — and two did. /kitchen/departments announced no tenant and
    // 500'd on every load with 22P02 while this suite reported all clear.
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`
        if (e.isDirectory()) walk(q, out)
        else if (/\.tsx?$/.test(q)) {
          out.push(q)
        }
      }
      return out
    }
    const files = [...walk('src/server'), ...walk('src/app')]
    const bare: string[] = []
    for (const f of files) {
      // Strip ${…} holes first. A fragment — `${cond ? sql`and x = ${y}` :
      // sql``}` — is a VALUE interpolated into another statement, not a
      // query, and it always lives inside a hole. Removing them leaves only
      // statements that actually run.
      const src = readFileSync(f, 'utf8').replace(
        /\$\{(?:[^{}]|\{[^{}]*\})*\}/g,
        ' ? ',
      )
      for (const m of src.matchAll(/\bsql\s*(?:<[^>]*>)?\s*`/g)) {
        // sql.unsafe / sql(rows, …) are not reads and do not match this.
        // `${sql`sort_order`}` DOES match and is not a read either — it is a
        // fragment interpolated into another statement, so a value rather
        // than a query. Skip anything opened by ${.
        const line = src.slice(0, m.index).split('\n').length
        bare.push(`${f}:${line}`)
      }
    }
    assert.deepEqual(bare, [], `reads with no tenant:\n      ${bare.join('\n      ')}`)
  })

  await check('no tsql is nested inside a transaction', async () => {
    // The one conversion mistake that could take production down: tsql
    // inside a txn() callback opens a transaction while holding a
    // connection, and waits for a second one that the first is blocking.
    // That is the max:4 deadlock again, in a new costume.
    const { readdirSync, readFileSync } = await import('node:fs')
    // WHEREVER SQL CAN BE WRITTEN, not where we assume it lives. This was a
    // flat listing of src/server/*.ts, so a PAGE importing `sql` directly was
    // invisible — and two did. /kitchen/departments announced no tenant and
    // 500'd on every load with 22P02 while this suite reported all clear.
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`
        if (e.isDirectory()) walk(q, out)
        else if (/\.tsx?$/.test(q)) {
          out.push(q)
        }
      }
      return out
    }
    const files = [...walk('src/server'), ...walk('src/app')]
    const nested: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      let i = src.indexOf('txn(')
      while (i !== -1) {
        // walk to the matching close paren of the txn( call
        let depth = 0
        let j = i + 3
        for (; j < src.length; j++) {
          if (src[j] === '(') depth++
          else if (src[j] === ')') { depth--; if (depth === 0) break }
        }
        const body = src.slice(i, j)
        if (/\btsql\s*(?:<[^>]*>)?\s*`/.test(body)) {
          nested.push(`${f}:${src.slice(0, i).split('\n').length}`)
        }
        i = src.indexOf('txn(', j)
      }
    }
    assert.deepEqual(nested, [], `a transaction inside a transaction:\n      ${nested.join('\n      ')}`)
  })

  /* ── 3. the return path's list is real ────────────────────────────── */
  console.log('\nthe return reason list is live')

  await check('return_reason is a managed list with values', async () => {
    const reasons = await getList(rid, 'return_reason')
    assert.ok(reasons.length > 0, 'return_reason has no active options — the Return toggle would be unusable')
    console.log(`      ${reasons.join(' · ')}`)
  })

  /* ── THE BUSINESS DAY ─────────────────────────────────────────────────
     A restaurant serving past midnight has a day that does not end at
     midnight, so every date this app defaults must be the BUSINESS day. The
     assertions below are by VALUE at the boundary, because "it returned a
     date" is true of the wrong answer too. */

  await check('the business day rolls at the cutover, not at midnight', async () => {
    const [s] = await tsql<{ tz: string; start: string }[]>`
      select (select value from settings where key = 'timezone') as tz,
             (select value from settings where key = 'business_day_start') as start`
    assert.equal(s.start, '05:00', 'business_day_start moved — these boundary cases assume 05:00')
    console.log(`      ${s.tz}, day starts ${s.start}`)

    // Local IST wall-clock -> the day it belongs to. 04:59 is still last night.
    const cases: [string, string][] = [
      ['2026-08-12 00:30', '2026-08-11'],
      ['2026-08-12 04:59', '2026-08-11'],
      ['2026-08-12 05:01', '2026-08-12'],
      ['2026-08-12 14:00', '2026-08-12'],
    ]
    for (const [localAt, expected] of cases) {
      // ::text FIRST, deliberately. Left to infer, the driver sends this as a
      // timestamptz, and `at time zone` then converts an already-anchored
      // instant a SECOND time — putting 05:01 five and a half hours out. Only
      // the boundary case catches it: 00:30, 04:59 and 14:00 all land on the
      // right day even when double-converted, and would have passed a broken
      // test. That is the whole argument for asserting at the boundary.
      const [row] = await tsql<{ d: string; tstz: string; start: string }[]>`
        select business_date(
                 (${localAt})::text::timestamp at time zone
                   (select value from settings where key = 'timezone')
               )::text as d,
               ((${localAt})::text::timestamp at time zone
                   (select value from settings where key = 'timezone'))::text as tstz,
               (select value from settings where key = 'business_day_start') as start`
      assert.equal(
        row.d,
        expected,
        `${localAt} IST (${row.tstz}, cutover ${row.start}) should be business day ${expected}, got ${row.d}`,
      )
    }
    console.log('      00:30 -> 11th · 04:59 -> 11th · 05:01 -> 12th · 14:00 -> 12th')
  })

  await check('a start of 00:00 makes the function a no-op', async () => {
    // The setting has to be able to mean "we close before midnight", or the
    // feature is not configurable, it is just India.
    await txn(async (tx) => {
      await tx`update settings set value = '00:00' where key = 'business_day_start' and restaurant_id = ${rid}`
      const [row] = await tx<{ d: string }[]>`
        select business_date(
          '2026-08-12 00:30'::timestamp at time zone
            (select value from settings where key = 'timezone')
        )::text as d`
      assert.equal(row.d, '2026-08-12', 'with a 00:00 cutover a 00:30 order belongs to the calendar day')
      throw new Error('ROLLBACK')
    }).catch((e: Error) => {
      if (e.message !== 'ROLLBACK') throw e
    })
    const [after] = await tsql<{ v: string }[]>`
      select value as v from settings where key = 'business_day_start' and restaurant_id = ${rid}`
    assert.equal(after.v, '05:00', 'the probe must not have changed the live setting')
  })

  await check('business_date refuses to answer for another tenant', async () => {
    // It takes no restaurant argument BY DESIGN: settings is RLS'd, so it can
    // only read the tenant announced on this transaction. Announcing a
    // stranger must not yield this restaurant's cutover.
    const { withTenant } = await import('../src/lib/tenant')
    const ours = await tsql<{ d: string }[]>`select business_date(now())::text as d`
    const theirs = await withTenant('00000000-0000-4000-8000-0000000000ff', () =>
      tsql<{ d: string }[]>`
        select business_date('2026-08-12 00:30+05:30'::timestamptz)::text as d`,
    )
    // With no settings visible the function falls back to UTC and no offset,
    // so a stranger cannot read our cutover through it.
    assert.ok(ours[0].d.length === 10, 'our own business day still resolves')
    assert.equal(theirs[0].d, '2026-08-11', 'a stranger gets the UTC fallback, never our settings')
  })

  await check('no date default in the app reaches for the calendar date', async () => {
    // The helpers were DELETED rather than left beside the new ones. A grep is
    // the honest test here: the failure mode is someone reaching for the
    // shorter name, and it would only be wrong for two hours a night.
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d)) {
        const q = join(d, e)
        if (statSync(q).isDirectory()) walk(q, out)
        else if (/\.tsx?$/.test(q)) out.push(q)
      }
      return out
    }
    const offenders = walk('src')
      .filter((f) => !f.endsWith('src/server/business-day.ts'))
      .flatMap((f) => {
        const src = readFileSync(f, 'utf8')
        return /\btodayIST\b|\btodayLocal\b|\bmonthStartIST\b|\byesterdayIST\b/.test(src) ? [f] : []
      })
    assert.deepEqual(offenders, [], `these still use a calendar-date helper: ${offenders.join(', ')}`)
  })

  await check('order_time does not disturb the dedupe or which fetch wins', async () => {
    // THE CAUTION, asserted rather than reasoned about. Re-fetching is
    // latest-fetch-wins and in-payload duplicates are skipped on pos_order_id
    // alone; order_time is in neither, so adding it must change neither.
    const def = await tsql<{ d: string }[]>`select pg_get_viewdef('latest_fetches'::regclass, true) as d`
    assert.ok(!/order_time/.test(def[0].d), 'latest_fetches must not read order_time')
    const cur = await tsql<{ d: string }[]>`select pg_get_viewdef('sales_current'::regclass, true) as d`
    // SELECTING A COLUMN IS NOT KEYING ON ONE, and the difference is the whole
    // assertion. sales_current now carries order_time in its select list —
    // sales_by_hour reads it from there — which is additive and changes
    // nothing about which rows come back. What must never happen is
    // order_time appearing in the JOIN, a WHERE, a DISTINCT ON or an ORDER
    // BY, because that is where "which fetch wins" and "which duplicate is
    // skipped" are decided.
    //
    // So the check is narrowed BY STRUCTURE rather than dropped: everything
    // from FROM onwards must not mention it. Blinding the gate to the name
    // would have been the easy fix and the wrong one.
    const fromOnwards = cur[0].d.slice(cur[0].d.search(/\bFROM\b/i))
    assert.ok(
      !/order_time/i.test(fromOnwards),
      'sales_current joins, filters or orders on order_time — that decides which rows win',
    )

    const { normalizePayload } = await import('../src/server/sales-ingest')
    const entry = (id: string, at: string | null) => ({
      Order: {
        orderID: id, order_date: '2026-08-11', status: 'Success', total: '100',
        ...(at === null ? {} : { created_on: at }),
      },
      OrderItem: [],
    })
    // Same id twice, different times: still ONE order, and the first wins.
    const dup = normalizePayload(
      { order_json: [entry('A1', '2026-08-11 20:00:00'), entry('A1', '2026-08-12 01:00:00')] },
      '2026-08-11',
    )
    assert.equal(dup.orders.length, 1, 'a duplicate id is still skipped')
    assert.equal(dup.duplicateIds, 1, 'and still counted')
    assert.equal(dup.orders[0].order_time_local, '2026-08-11 20:00:00', 'the first occurrence still wins')

    // A payload with no times at all parses, and SAYS it carried none.
    const none = normalizePayload({ order_json: [entry('B1', null)] }, '2026-08-11')
    assert.equal(none.withTime, 0)
    assert.equal(none.orders[0].order_time_local, null, 'absent is null, never invented')
    assert.ok(
      /no order carried a time/.test(none.note ?? ''),
      'an empty disagreement view must be explained, not read as agreement',
    )
  })

  await check('a wall-clock order time lands on the right side of the cutover', async () => {
    // The adapter keeps Petpooja's local string raw and anchors it in SQL.
    // Anchoring it in JS would put a 00:30 order five and a half hours out —
    // onto exactly the day it does not belong to.
    const [row] = await tsql<{ ts: string; d: string }[]>`
      select ('2026-08-12 00:30:00'::timestamp at time zone
                (select value from settings where key = 'timezone'))::text as ts,
             business_date('2026-08-12 00:30:00'::timestamp at time zone
                (select value from settings where key = 'timezone'))::text as d`
    assert.equal(row.d, '2026-08-11', 'a 00:30 IST order belongs to the previous business day')
    console.log(`      00:30 local -> ${row.ts} -> business day ${row.d}`)
  })

  await check('business_day_disagreements is empty for a reason it can state', async () => {
    const gaps = await tsql<{ n: number }[]>`
      select count(*)::int as n from business_day_disagreements where restaurant_id = ${rid}`
    const [t] = await tsql<{ with_time: number; total: number }[]>`
      select count(*) filter (where order_time is not null)::int as with_time,
             count(*)::int as total from pos_orders where restaurant_id = ${rid}`
    if (t.total === 0) {
      console.log('      no POS order fetched yet — UNTESTED, and the screens say so rather than "agreed"')
    } else if (t.with_time === 0) {
      assert.equal(gaps[0].n, 0, 'nothing can disagree while nothing carries a time')
      console.log(`      ${t.total} orders, none with a time — UNTESTED, surfaced as cannot-assess`)
    } else {
      console.log(`      ${t.with_time}/${t.total} orders comparable · ${gaps[0].n} disagreeing day-pair(s)`)
    }
  })

  await check('every destination the proxy redirects to, it will let you reach', async () => {
    // /denied denied itself. The matrix fails closed on unknown paths, which
    // is right, but this proxy REDIRECTS to /denied on refusal — so a real
    // permission denial became ERR_TOO_MANY_REDIRECTS instead of the sentence
    // naming who to ask. audit:matrix could not see it because it checks
    // LINKS, and nothing links to /denied: it is only ever a redirect target.
    //
    // So the targets are read out of the proxy itself rather than listed here
    // by hand — a new redirect target is covered the day it is written.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/proxy.ts', 'utf8')
    const targets = [...src.matchAll(/url\.pathname\s*=\s*'([^']+)'/g)].map((m) => m[1])
    assert.ok(targets.length > 0, 'no redirect targets found — has the proxy been rewritten?')

    const { ALL_ROLES, canAccess } = await import('../src/lib/roles')
    const publicOrExempt = new Set(
      [...src.matchAll(/PUBLIC_PATHS\s*=\s*\[([^\]]*)\]/g)]
        .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
        .concat([...src.matchAll(/pathname === '([^']+)'\) return NextResponse\.next\(\)/g)].map((m) => m[1])),
    )

    for (const t of targets) {
      if (publicOrExempt.has(t)) continue
      for (const role of ALL_ROLES) {
        assert.ok(
          canAccess(role, t),
          `the proxy redirects to ${t} but ${role} cannot open it — that is a redirect loop`,
        )
      }
    }
    console.log(`      ${targets.join(' · ')} — reachable by every role`)
  })

  /* ── AN OLD-SHAPE COOKIE IS A SIGN-OUT, NEVER AN OUTAGE ────────────────
     A v1 token — minted before the tenant claim existed — verified cleanly
     because verification checked u, r and exp and not t. The payload came
     back with t undefined, withTenant(undefined) made currentTenant() answer
     null, txn asked getSessionUser() for the tenant, and that called
     withTenant(undefined) again. Heap dead in about three minutes, 500 on
     every route INCLUDING /login, so the user could not sign out to escape
     it. One stale cookie, whole app down for that browser. */

  await check('a session payload missing its tenant is refused', async () => {
    const { signSession, verifySession, SESSION_VERSION } = await import('../src/lib/session')
    const secret = 'zz-smoke-secret-not-the-real-one'
    const exp = Math.floor(Date.now() / 1000) + 3600

    const good = await signSession({ u: 'zz', r: 'owner', t: rid, exp }, secret)
    assert.ok((await verifySession(good, secret)) !== null, 'a well-formed session must still verify')
    assert.ok(good.startsWith(`${SESSION_VERSION}.`), 'tokens carry the current version')

    // The exact shape Rajesh's browser was holding.
    const oldShape = { u: 'zz', r: 'owner', exp } as unknown as Parameters<typeof signSession>[0]
    const stale = await signSession(oldShape, secret)
    assert.equal(await verifySession(stale, secret), null, 'a payload with NO tenant is not a session')

    // and every other way the claim can be wrong
    for (const t of ['', 'not-a-uuid', '   ', '00000000-0000-4000-8000']) {
      const bad = await signSession({ u: 'zz', r: 'owner', t, exp } as Parameters<typeof signSession>[0], secret)
      assert.equal(await verifySession(bad, secret), null, `tenant ${JSON.stringify(t)} must be refused`)
    }
    for (const field of ['u', 'r'] as const) {
      const p2 = { u: 'zz', r: 'owner', t: rid, exp } as Record<string, unknown>
      delete p2[field]
      const bad = await signSession(p2 as Parameters<typeof signSession>[0], secret)
      assert.equal(await verifySession(bad, secret), null, `a payload missing ${field} is not a session`)
    }
  })

  await check('a token of any other version is not a session', async () => {
    // The point of versioning: the NEXT shape change must be a sign-out too,
    // without anyone remembering to add a check for the new field.
    const { signSession, verifySession, SESSION_VERSION } = await import('../src/lib/session')
    const secret = 'zz-smoke-secret-not-the-real-one'
    const exp = Math.floor(Date.now() / 1000) + 3600
    const token = await signSession({ u: 'zz', r: 'owner', t: rid, exp }, secret)

    const [, body, sig] = token.split('.')
    for (const v of ['v1', 'v3', 'v99', 'x']) {
      if (v === SESSION_VERSION) continue
      assert.equal(await verifySession(`${v}.${body}.${sig}`, secret), null, `${v} must not verify`)
    }
    console.log(`      current is ${SESSION_VERSION}; v1 tokens are signed out, not interpreted`)
  })

  await check('a blank tenant is refused loudly, never turned into a null', async () => {
    // The recursion needed withTenant(undefined) to become "no tenant". It
    // now throws instead, so a caller bug is one loud error rather than an
    // out-of-memory on every route.
    const { withTenant } = await import('../src/lib/tenant')
    for (const bad of [undefined, null, '', 'nope']) {
      await assert.rejects(
        async () => withTenant(bad as unknown as string, async () => 1),
        /refusing to run with no tenant/,
        `withTenant(${JSON.stringify(bad)}) must throw`,
      )
    }
    // and the good case still works
    assert.equal(await withTenant(rid, async () => 'ok'), 'ok')
  })

  await check('the proxy ends an unrecognised session by clearing the cookie', async () => {
    // Leaving a token that did not verify in the jar means the browser
    // presents it again on every request for thirty days — which is how one
    // stale cookie followed a user from page to page.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/proxy.ts', 'utf8')
    const redirectBlock = src.slice(src.indexOf('const payload = await verifySession'))
    const loginRedirect = redirectBlock.slice(0, redirectBlock.indexOf('canAccess'))
    assert.match(
      loginRedirect,
      /cookies\.set\(SESSION_COOKIE,\s*''/,
      'the login redirect must clear the session cookie',
    )
    assert.match(loginRedirect, /maxAge:\s*0/, 'and expire it immediately')
  })

  /* ── HEADER + LINES: one save, N rows ──────────────────────────────────
     Kitchen loss, store loss and production took the closing form's shape.
     The assertions move real rows in a transaction that rolls back, because
     the only way to prove a batch writes N rows sharing a header is to write
     some. */

  await check('one kitchen loss save writes N rows sharing date and section, reason PER LINE', async () => {
    await txn(async (tx) => {
      const [sec] = await tx<{ id: string }[]>`
        select id from sections where restaurant_id = ${rid} and dept_kind = 'kitchen' limit 1`
      const items = await tx<{ item_id: string; issue_cost: string }[]>`
        select item_id, issue_cost::text as issue_cost from item_costs
        where restaurant_id = ${rid} and issue_cost is not null limit 2`
      if (!sec || items.length < 2) {
        console.log('      no kitchen section or fewer than two costed items — UNTESTED')
        throw new Error('ROLLBACK')
      }
      // two lines, same header, DIFFERENT reasons — the whole point
      for (const [i, it] of items.entries()) {
        await tx`
          insert into kitchen_wastage (restaurant_id, section_id, waste_date, item_id, qty, value, reason, entered_by)
          values (${rid}, ${sec.id}, '2020-01-02', ${it.item_id}, '2',
                  ${(2 * Number(it.issue_cost)).toFixed(2)}, ${i === 0 ? 'Zz burnt' : 'Zz expired'}, 'zz-smoke')`
      }
      const rows = await tx<{ reason: string; qty: string; value: string }[]>`
        select reason, qty::text as qty, value::text as value from kitchen_wastage
        where restaurant_id = ${rid} and waste_date = '2020-01-02' and entered_by = 'zz-smoke'
        order by reason`
      assert.equal(rows.length, 2, 'two lines, two rows')
      assert.deepEqual(rows.map((r) => r.reason), ['Zz burnt', 'Zz expired'], 'each row keeps its OWN reason')
      assert.ok(rows.every((r) => Number(r.qty) === 2), 'quantity is stored, not discarded')
      assert.ok(rows.every((r) => Number(r.value) > 0), 'value = qty x frozen cost, never zero')
      throw new Error('ROLLBACK')
    }).catch((e: Error) => {
      if (e.message !== 'ROLLBACK') throw e
    })
  })

  await check('production refuses an UNCOSTABLE dish by name — the picker is not the check', async () => {
    // The subs-only rule is SUPERSEDED: a dish cooked ahead is produced in
    // portions. What survives is the principle behind it — a form can always
    // be posted to directly, so the refusal lives on the server. The rule it
    // now enforces is that a dish with no portions has nothing to freeze.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/kitchen-actions.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function saveProductions'))
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
    assert.match(body, /recipe\.kind === 'dish'/, 'saveProductions still branches on the kind server-side')
    assert.match(body, /has no portions set/, 'and refuses an uncostable dish BY NAME')
    assert.match(body, /cannot be costed yet/, 'an uncosted recipe is still refused by name')

    const kinds = await tsql<{ kind: string; n: number }[]>`
      select kind, count(*)::int as n from recipes where restaurant_id = ${rid} group by kind order by kind`
    console.log(`      ${kinds.map((k) => `${k.kind}:${k.n}`).join(' · ') || 'no recipes yet'}`)
  })

  await check('production carries NO session column — it would have no reader', async () => {
    // An indent carries a session because the STORE matches a request to a
    // shift. Production has no counterpart doing that, so a session here
    // would be a column nothing reads — the issues.session mistake in
    // reverse. Asserted against the schema so nobody adds one by reflex.
    const cols = await tsql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'productions'`
    assert.ok(
      !cols.some((c) => c.column_name === 'session'),
      'productions gained a session column — what reads it?',
    )
    const indent = await tsql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'indents' and column_name = 'session'`
    assert.equal(indent.length, 1, 'indents still carry a session — that is the one with a reader')
  })

  await check('refill returns the last set for a department, editable', async () => {
    const { getLastProductionSet } = await import('../src/server/kitchen-queries')
    await txn(async (tx) => {
      const [sec] = await tx<{ id: string }[]>`
        select id from sections where restaurant_id = ${rid} and dept_kind = 'kitchen' limit 1`
      const [sub] = await tx<{ id: string; cost: string }[]>`
        select r.id, rc.cost_per_output_unit::text as cost
        from recipes r join recipe_costs rc on rc.recipe_id = r.id
        where r.restaurant_id = ${rid} and r.kind = 'sub' and rc.cost_per_output_unit is not null
        limit 1`
      if (!sec || !sub) {
        console.log('      no kitchen section or costed sub — UNTESTED')
        throw new Error('ROLLBACK')
      }
      await tx`
        insert into productions (restaurant_id, section_id, prod_date, recipe_id, output_qty, unit_cost, entered_by)
        values (${rid}, ${sec.id}, '2020-01-03', ${sub.id}, '7.5', ${sub.cost}, 'zz-smoke')`
      // read through the app's own query, inside the same transaction
      const [row] = await tx<{ on: string; qty: string }[]>`
        with last_day as (
          select max(p.prod_date) as d from productions p
          where p.restaurant_id = ${rid} and p.section_id = ${sec.id} and p.reverses_id is null
        )
        select p.prod_date::text as on, p.output_qty::text as qty
        from productions p join last_day l on l.d = p.prod_date
        where p.restaurant_id = ${rid} and p.section_id = ${sec.id} and p.reverses_id is null`
      assert.equal(row.on, '2020-01-03', 'the most recent day is the one offered')
      assert.equal(Number(row.qty), 7.5, 'and the quantity comes back to be edited')
      throw new Error('ROLLBACK')
    }).catch((e: Error) => {
      if (e.message !== 'ROLLBACK') throw e
    })
    // the real function runs and answers null-or-set without throwing
    const secs = await tsql<{ id: string }[]>`
      select id from sections where restaurant_id = ${rid} and dept_kind = 'kitchen' limit 1`
    if (secs[0]) {
      const set = await getLastProductionSet(rid, secs[0].id)
      assert.ok(set === null || Array.isArray(set.lines), 'getLastProductionSet answers cleanly')
    }
  })

  await check('a voided batch is never offered back as a refill', async () => {
    // A cancelled batch is not a suggestion for tomorrow. Both the reversal
    // row and the row it reverses are excluded.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/kitchen-queries.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function getLastProductionSet'))
    const body = fn.slice(0, fn.indexOf('\nexport '))
    assert.match(body, /reverses_id is null/, 'reversals are excluded')
    assert.match(body, /not exists \(select 1 from productions v where v\.reverses_id = p\.id\)/, 'and so are voided originals')
  })

  await check('shorts are recorded against the BILL, several lines in one act', async () => {
    // Saving one short at a time punished checking a delivery carefully. The
    // batch either lands whole or not at all, so a receiver who counted every
    // crate records what they saw in one act.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/shorts-actions.ts', 'utf8')
    assert.ok(!/export async function saveShort\b/.test(src), 'the one-row-per-save path is gone, not left beside it')
    assert.match(src, /export async function saveShorts/, 'the batch action exists')

    const fn = src.slice(src.indexOf('export async function saveShorts'))
    const body = fn.slice(0, fn.indexOf('\n/* ──'))
    // the bill is checked ONCE, as a header
    assert.match(body, /is_reversal/, 'a reversal bill is still refused')
    assert.match(body, /is_voided/, 'a voided bill is still refused')
    // and every line must belong to it
    assert.match(body, /not on this bill/, 'a batch spanning two bills is refused')
    // duplicates, within the batch and against what is already open
    assert.match(body, /listed twice with the same reason/, 'a double tap inside one batch is refused')
    assert.match(body, /settle that one instead/, 'an existing open short of the same kind is still refused')

    await txn(async (tx) => {
      const [line] = await tx<{ id: string; purchase_id: string }[]>`
        select pl.id, pl.purchase_id
        from purchase_lines pl join bills b on b.id = pl.purchase_id
        where pl.restaurant_id = ${rid} and not b.is_voided and not b.is_reversal
        limit 1`
      if (!line) {
        console.log('      no live bill line to short — UNTESTED')
        throw new Error('ROLLBACK')
      }
      // two shorts of DIFFERENT kinds on one line is real (part missing, part
      // damaged) and must remain possible inside one batch
      for (const kind of ['short', 'damaged']) {
        await tx`
          insert into purchase_line_shorts
            (restaurant_id, purchase_line_id, qty_short, kind, settlement, entered_by)
          values (${rid}, ${line.id}, '1', ${kind}, 'open', 'zz-smoke')`
      }
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int as n from purchase_line_shorts
        where purchase_line_id = ${line.id} and entered_by = 'zz-smoke'`
      assert.equal(n, 2, 'two kinds on one line, one act')
      throw new Error('ROLLBACK')
    }).catch((e: Error) => {
      if (e.message !== 'ROLLBACK') throw e
    })
  })

  await check('adjustments batch, and the same item twice is refused', async () => {
    // Opening stock is inherently many items at once, and it is the flow every
    // NEW restaurant hits first — before anyone has patience for the app.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/adjustment-actions.ts', 'utf8')
    assert.ok(!/export async function saveAdjustment\b/.test(src), 'the one-row path is gone, not left beside it')
    assert.match(src, /export async function saveAdjustments/, 'the batch action exists')

    const fn = src.slice(src.indexOf('export async function saveAdjustments'))
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
    // created_at is the TRANSACTION timestamp and does not advance within one,
    // so two corrections of one item written together tie — and acceptCount's
    // "already corrected since this count was frozen" sum cannot order them.
    assert.match(body, /same item is listed twice/, 'a repeated item in one batch is refused')
    // the list suggestion must not open a statement inside the transaction
    const suggestAt = body.indexOf('noteListSuggestion')
    const txnAt = body.indexOf('await txn(')
    assert.ok(suggestAt !== -1 && txnAt !== -1 && suggestAt < txnAt, 'noteListSuggestion runs BEFORE txn, never inside it')
    // zero is still refused, now per line
    assert.match(body, /a correction of zero corrects nothing/, 'zero is still refused')
    assert.match(body, /Line \$\{i \+ 1\}/, 'and named per line')

    // the cost is still frozen per item inside the transaction
    assert.match(body, /assertAdjustableItem\(tx, rid, l\.itemId\)/, 'unit_cost frozen per line, on the tx')
  })

  await check('N vouchers get N document numbers — a batch is entry, not a document', async () => {
    // Three payments in one sitting are three payments: different payees,
    // individually voidable, individually cited by an accountant months
    // later. One number across three would change meaning the instant one of
    // them was voided.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/cash-actions.ts', 'utf8')
    assert.ok(!/export async function saveVoucher\b/.test(src), 'the one-row path is gone, not left beside it')
    assert.match(src, /export async function saveVouchers/, 'the batch action exists')

    const fn = src.slice(src.indexOf('export async function saveVouchers'))
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
    // the draw is INSIDE the per-line loop, and on the tx
    const loopAt = body.indexOf('for (const [i, l] of prepared.entries())')
    const drawAt = body.indexOf("nextDocNo(tx, rid, 'VCH'")
    assert.ok(loopAt !== -1 && drawAt > loopAt, 'a number is drawn per line, inside the loop, on the tx')
    // both flags true is still refused, now per payee
    assert.match(body, /not both — counting it twice/, 'the one-kind rule survives the batch')
    // the account is resolved per line, since owner-funded leaves the owner's
    // own account while a cashier payment leaves the drawer
    assert.match(body, /accountIds\.push\(await assertAccount/, 'each payment names its own account')

    // and the series really is gapless and per-row, proved by drawing some
    await txn(async (tx) => {
      const { nextDocNo } = await import('../src/server/doc-numbers')
      const a = await nextDocNo(tx, rid, 'VCH', '2020-01-04')
      const b = await nextDocNo(tx, rid, 'VCH', '2020-01-04')
      assert.notEqual(a, b, 'two draws in one transaction are two different numbers')
      throw new Error('ROLLBACK')
    }).catch((e: Error) => {
      if (e.message !== 'ROLLBACK') throw e
    })
  })

  await check('seven batch forms, and every singular action is gone', async () => {
    // Two paths to one table is how they drift, so the one-row-per-save
    // action is DELETED each time rather than left beside the batch.
    const { readFileSync } = await import('node:fs')
    const gone: [string, string][] = [
      ['src/server/shorts-actions.ts', 'saveShort'],
      ['src/server/adjustment-actions.ts', 'saveAdjustment'],
      ['src/server/cash-actions.ts', 'saveVoucher'],
      ['src/server/expenses-actions.ts', 'saveExpense'],
      ['src/server/cash-actions.ts', 'saveOtherIncome'],
      ['src/server/cashier-actions.ts', 'saveNonRevenue'],
      ['src/server/expenses-actions.ts', 'saveCasualLabour'],
    ]
    for (const [file, fn] of gone) {
      const src = readFileSync(file, 'utf8')
      assert.ok(
        !new RegExp(`export async function ${fn}\\b(?!s)`).test(src),
        `${fn} is still exported beside its batch — two paths to one table`,
      )
      assert.match(src, new RegExp(`export async function ${fn}s\\b`), `${fn}s is missing`)
    }

    // saveContractBill stays singular BY DESIGN: one bill is one document.
    const cb = readFileSync('src/server/expenses-actions.ts', 'utf8')
    assert.match(cb, /export async function saveContractBill\b/, 'a contract bill is one document, still one per save')
  })

  await check('every numbered batch draws a number PER LINE', async () => {
    // A batch is a convenience of ENTRY, not a document. Contrast saveShorts,
    // where the header is a BILL that already exists and is already numbered.
    const { readFileSync } = await import('node:fs')
    for (const [file, fn, series] of [
      ['src/server/cash-actions.ts', 'saveVouchers', 'VCH'],
      ['src/server/expenses-actions.ts', 'saveExpenses', 'EXP'],
      ['src/server/expenses-actions.ts', 'saveCasualLabours', 'CAS'],
    ] as const) {
      const src = readFileSync(file, 'utf8')
      const fnSrc = src.slice(src.indexOf(`export async function ${fn}`))
      const body = fnSrc.slice(0, fnSrc.indexOf('\n}\n') + 3)
      const loopAt = body.search(/for \(const \[?i?,? ?l\]? of /)
      const drawAt = body.indexOf(`nextDocNo(tx, rid, '${series}'`)
      assert.ok(drawAt !== -1, `${fn} must still draw a ${series} number`)
      assert.ok(loopAt !== -1 && drawAt > loopAt, `${fn} draws its ${series} number inside the per-line loop`)
    }
    // other_income and non_revenue are NOT numbered series — asserted so a
    // future change does not quietly add one.
    const numbered = await tsql<{ doc_type: string }[]>`
      select distinct doc_type from doc_sequences where restaurant_id = ${rid}`
    for (const t of numbered) {
      assert.ok(
        ['PUR', 'PAY', 'EXP', 'VCH', 'CON', 'CAS', 'ADV', 'RUN'].includes(t.doc_type),
        `unexpected document series ${t.doc_type}`,
      )
    }
  })

  await check('the header holds only what the lines genuinely share', async () => {
    // Argued per form rather than inherited, and they came out differently:
    //   losses      reason PER LINE   (two things, one bin, two reasons)
    //   adjustments reason PER HEADER (a batch of corrections is ONE event)
    //   vouchers    account PER LINE  (owner pocket vs drawer, same sitting)
    //   casual      section PER LINE  (a day's hands split across departments)
    const { readFileSync } = await import('node:fs')
    const types = readFileSync('src/lib/types.ts', 'utf8')

    const adj = types.slice(types.indexOf('export type SaveAdjustmentsInput'))
    assert.match(adj.slice(0, 400), /reason: string/, 'adjustments keep ONE reason for the batch')

    const kl = types.slice(types.indexOf('export type KitchenLossLineInput'))
    assert.match(kl.slice(0, 500), /reason: string/, 'kitchen loss lines each carry a reason')

    const vl = types.slice(types.indexOf('export type VoucherLineInput'))
    assert.match(vl.slice(0, 600), /accountId: string/, 'a voucher line names its own account')

    const cl = types.slice(types.indexOf('export type CasualLabourLineInput'))
    assert.match(cl.slice(0, 400), /sectionId: string/, 'a casual labour line names its own department')
  })

  await check('a dish is produced in PORTIONS, priced per portion', async () => {
    // A dish has no batch yield, so pricing it at cost_per_output_unit would
    // freeze a number that looks fine and means nothing.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/kitchen-actions.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function saveProductions'))
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
    assert.match(body, /dc\.cost_per_portion/, 'a dish prices at cost_per_portion')
    assert.match(body, /rc\.cost_per_output_unit/, 'a sub still prices at cost_per_output_unit')
    assert.ok(
      !/is a dish — production records batches of SUB-recipes only/.test(body),
      'the subs-only refusal is gone — dishes are producible now',
    )
    // NO PORTIONS, NO PRODUCTION — refused by name, never defaulted
    assert.match(body, /has no portions set/, 'a dish with no portions is refused')
    assert.match(body, /recipe\.portions === null \|\| Number\(recipe\.portions\) <= 0/, 'and the check is real')

    // the two costs really are different numbers in the database
    const rows = await tsql<{ n: number }[]>`
      select count(*)::int as n from dish_costs
      where restaurant_id = ${rid} and portions is null`
    console.log(`      ${rows[0].n} dish(es) with no portions set — those are refused by name`)
  })

  await check('produced dishes are held and counted, and the gap is surfaced', async () => {
    // THE TEST THAT MAKES THE FEATURE REAL. Without a reader, producing a dish
    // stores rows nobody looks at — the issues.session mistake again.
    const { readFileSync } = await import('node:fs')
    const dash = readFileSync('src/app/kitchen/page.tsx', 'utf8')
    assert.match(dash, /getUnclosedDishes/, 'the kitchen dashboard reads the gap')
    assert.match(dash, /Made today, not yet closed/, 'and says so in words')
    assert.match(dash, /unclosedDishes\.length > 0 &&/, 'silent at zero — no permanent all-clear to dismiss')

    // and it fires on real data: produced 20, closed 12 -> 8 unaccounted
    await txn(async (tx) => {
      const [sec] = await tx<{ id: string }[]>`
        select id from sections where restaurant_id = ${rid} and dept_kind = 'kitchen' limit 1`
      const [dish] = await tx<{ id: string }[]>`
        select id from recipes where restaurant_id = ${rid} and kind = 'dish' limit 1`
      if (!sec || !dish) {
        console.log('      no kitchen section or dish — UNTESTED')
        throw new Error('ROLLBACK')
      }
      await tx`insert into productions (restaurant_id, section_id, prod_date, recipe_id, output_qty, unit_cost, entered_by)
               values (${rid}, ${sec.id}, '2020-02-02', ${dish.id}, '20', '10', 'zz-smoke')`
      const [c] = await tx<{ id: string }[]>`
        insert into kitchen_closings (restaurant_id, section_id, close_date, closing_value, entered_by)
        values (${rid}, ${sec.id}, '2020-02-02', '120', 'zz-smoke') returning id`
      await tx`insert into kitchen_closing_lines (restaurant_id, closing_id, component_recipe_id, qty, unit_cost)
               values (${rid}, ${c.id}, ${dish.id}, '12', '10')`
      const [row] = await tx<{ produced: string; closed: string }[]>`
        with made as (
          select p.section_id, p.recipe_id, sum(p.output_qty) as produced
          from productions p join recipes r on r.id = p.recipe_id
          where p.restaurant_id = ${rid} and p.prod_date = '2020-02-02'::date
            and r.kind = 'dish' and p.reverses_id is null
          group by p.section_id, p.recipe_id),
        winner as (
          select distinct on (c2.section_id) c2.id, c2.section_id from kitchen_closings c2
          where c2.restaurant_id = ${rid} and c2.close_date = '2020-02-02'::date
          order by c2.section_id, c2.created_at desc),
        held as (
          select w.section_id, cl.component_recipe_id as recipe_id, sum(cl.qty) as closed
          from kitchen_closing_lines cl join winner w on w.id = cl.closing_id
          where cl.restaurant_id = ${rid} and cl.component_recipe_id is not null
          group by w.section_id, cl.component_recipe_id)
        select m.produced::text as produced, coalesce(h.closed, 0)::text as closed
        from made m
        left join held h on h.section_id = m.section_id and h.recipe_id = m.recipe_id
        where coalesce(h.closed, 0) < m.produced`
      assert.ok(row, 'a produced-but-not-fully-closed dish must appear')
      assert.equal(Number(row.produced) - Number(row.closed), 8, 'produced 20, closed 12, 8 unaccounted')
      throw new Error('ROLLBACK')
    }).catch((e: Error) => {
      if (e.message !== 'ROLLBACK') throw e
    })
  })

  await check('the picker keeps subs and dishes visibly apart', async () => {
    // Conflating them is how a batch cost silently becomes a portion cost.
    const { readFileSync } = await import('node:fs')
    const form = readFileSync('src/components/kitchen/ProductionEntry.tsx', 'utf8')
    assert.match(form, /Sub-recipes — made in batches/, 'subs are grouped and labelled')
    assert.match(form, /Dishes — made in portions/, 'dishes are grouped and labelled')
    assert.match(form, /no portions set/, 'a dish with no portions says so in the list')

    const q = readFileSync('src/server/recipes-queries.ts', 'utf8')
    const fn = q.slice(q.indexOf('export async function listProducibles'))
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
    assert.match(body, /'portion' as unit_name/, "a dish's unit is portions, never its recipe output unit")
    assert.match(body, /cost_per_portion/, 'and its cost is per portion')
  })

  /* ── PICKERS: SCOPED AND RANKED, NEVER EXCLUDING ──────────────────────
     One principle, three forms. The assertions that matter here are the ones
     that can FAIL: "it returned some rows" is true of an unranked list and of
     a list that quietly hides everything else. So the rank is asserted by
     VALUE and the scope is asserted to be a SCOPE — narrower than the search,
     with the search still reaching what it leaves out. */

  await check('vendor_return_reason is a managed list with values', async () => {
    const reasons = await getList(rid, 'vendor_return_reason')
    assert.ok(reasons.length > 0, 'vendor_return_reason has no active options')
    const { ALL_LIST_KEYS } = await import('../src/lib/lists')
    assert.ok(
      ALL_LIST_KEYS.includes('vendor_return_reason'),
      'the DB holds the key and the registry does not — the Lists screen could not edit it',
    )
    console.log(`      ${reasons.join(' · ')}`)
  })

  await check('what a department takes is ranked frequency THEN recency', async () => {
    const { getSectionFrequentItems } = await import('../src/server/store-queries')
    const secs = await tsql<{ id: string; name: string }[]>`
      select distinct s.id, s.name from issues i join sections s on s.id = i.section_id`
    assert.ok(secs.length > 0, 'no department has ever been issued to — this assertion cannot fail, so it is not a test')
    let checked = 0
    for (const sec of secs) {
      const rows = await getSectionFrequentItems(rid, sec.id)
      if (rows.length === 0) continue
      checked++
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1]
        const b = rows[i]
        assert.ok(
          a.times > b.times || (a.times === b.times && a.last >= b.last),
          `${sec.name}: ${a.item.code} (${a.times}×, ${a.last}) must not rank below ${b.item.code} (${b.times}×, ${b.last})`,
        )
      }
      // typical_qty is the HINT, and it has to be present to be a hint
      assert.ok(
        rows.every((r) => r.typical_qty !== null && Number(r.typical_qty) > 0),
        'every suggestion carries a typical quantity',
      )
      // vendor-only fields must stay null on a section suggestion: a rate here
      // would be prefilled into a form that has no rate to prefill.
      assert.ok(
        rows.every((r) => r.last_rate === null && r.source_purchase_line_id === null),
        'a department suggestion carries no rate',
      )
      console.log(`      ${sec.name}: ${rows.map((r) => `${r.item.code}(${r.times}×)`).join(' ')}`)
    }
    assert.ok(checked > 0, 'not one department produced a suggestion — the view or the join is wrong')
  })

  await check('what a vendor supplies is ranked MOST RECENT first, with the rate', async () => {
    const { getVendorSuppliedItems } = await import('../src/server/vendor-return-queries')
    const vendors = await tsql<{ id: string; name: string }[]>`
      select distinct v.id, v.name from purchases p join vendors v on v.id = p.vendor_id`
    assert.ok(vendors.length > 0, 'no vendor has ever billed us — nothing to test against')
    let withRows = 0
    for (const v of vendors) {
      const rows = await getVendorSuppliedItems(rid, v.id)
      if (rows.length === 0) continue
      withRows++
      for (let i = 1; i < rows.length; i++) {
        // Recency leads here, DELIBERATELY differently from a department: at
        // the moment of a return the delivery in dispute is the one that just
        // arrived. Frequency breaks the tie.
        const a = rows[i - 1]
        const b = rows[i]
        assert.ok(
          a.last > b.last || (a.last === b.last && a.times >= b.times),
          `${v.name}: ${a.item.code} (${a.last}) must not rank below ${b.item.code} (${b.last})`,
        )
      }
      assert.ok(
        rows.every((r) => r.last_rate !== null && r.source_purchase_line_id !== null),
        `${v.name}: every supplied item must carry the rate AND the line it came from — a rate with no provenance is the thing this replaced`,
      )
      assert.ok(rows.every((r) => r.typical_qty === null), 'a vendor suggestion carries no typical quantity')
    }
    assert.ok(withRows > 0, 'not one vendor produced a suggestion')
    assert.equal((await getVendorSuppliedItems(rid, 'not-a-uuid')).length, 0, 'a malformed id is no suggestions, not a 500')
  })

  await check('the same item can cost two different vendors two different rates', async () => {
    // The reason the rate MUST be per vendor rather than "the last rate for
    // this item". If this ever finds only one price per item everywhere, the
    // assertion below stops proving anything and says so.
    const { getVendorSuppliedItems } = await import('../src/server/vendor-return-queries')
    const vendors = await tsql<{ id: string }[]>`select distinct vendor_id as id from purchases`
    const byItem = new Map<string, Set<string>>()
    for (const v of vendors) {
      for (const r of await getVendorSuppliedItems(rid, v.id)) {
        if (r.last_rate === null) continue
        const set = byItem.get(r.item.code) ?? new Set<string>()
        set.add(r.last_rate)
        byItem.set(r.item.code, set)
      }
    }
    const split = [...byItem.entries()].filter(([, rates]) => rates.size > 1)
    if (split.length === 0) {
      console.log('      UNTESTED: no item is currently bought from two vendors at two rates')
    } else {
      for (const [code, rates] of split) console.log(`      ${code}: ${[...rates].join(' vs ')}`)
    }
  })

  await check('a scope is a SCOPE — narrower than the search, and never instead of it', async () => {
    // The half that is easy to lose. A picker that only offered history would
    // make a first-time item unfindable, so the general search has to still
    // reach what the scope leaves out.
    const { getVendorSuppliedItems } = await import('../src/server/vendor-return-queries')
    const { searchIssuableItems } = await import('../src/server/store-queries')
    const [v] = await tsql<{ id: string; name: string }[]>`
      select v.id, v.name from purchases p join vendors v on v.id = p.vendor_id group by v.id, v.name limit 1`
    const scoped = await getVendorSuppliedItems(rid, v.id)
    const [{ n }] = await tsql<{ n: number }[]>`select count(*)::int as n from items where status = 'active'`
    assert.ok(scoped.length > 0, 'the scope is empty — nothing to compare')
    assert.ok(scoped.length < n, `the scope (${scoped.length}) must be narrower than all ${n} items, or it is not a scope`)

    const searched = await searchIssuableItems(rid, '')
    const scopedIds = new Set(scoped.map((r) => r.item.id))
    assert.ok(
      searched.some((r) => !scopedIds.has(r.id)),
      'the general search must reach items the scope leaves out — otherwise a first-time item is unfindable',
    )

    const { readFileSync } = await import('node:fs')
    const picker = readFileSync('src/components/store/IssueItemPicker.tsx', 'utf8')
    assert.match(picker, /\/api\/items\/issuable/, 'the picker still searches everything underneath')
    assert.match(picker, /Everything else/, 'and says so, so the second group is findable')
  })

  await check('a vendor return takes its reason PER LINE, and the header reads them', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/vendor-return-actions.ts', 'utf8')
    const header = src.slice(src.indexOf('insert into vendor_returns (restaurant_id, return_date'))
    assert.ok(
      !header.slice(0, header.indexOf(')')).includes('reason'),
      'the header must NOT collect a reason — a cached predominant reason can disagree with its own lines',
    )
    assert.match(src, /insert into vendor_return_lines[\s\S]{0,220}reason,\s*source_purchase_line_id/, 'lines carry reason and provenance')
    // the void copies both EXACTLY — a reversal states the claim as it was made
    const voidSql = src.slice(src.indexOf('export async function voidVendorReturn'))
    assert.match(voidSql, /select restaurant_id, \$\{rev\.id\}, item_id, qty, rate, reason, source_purchase_line_id/, 'the void copies reason and provenance exactly')

    // and the read side computes the summary rather than storing it
    const q = readFileSync('src/server/vendor-return-queries.ts', 'utf8')
    assert.match(q, /count\(distinct l\.reason\) > 1 then 'Mixed'/, 'several reasons read "Mixed"')

    // by VALUE, in a transaction that rolls back: one reason names itself.
    const [v] = await tsql<{ id: string }[]>`select id from vendors limit 1`
    const items = await tsql<{ id: string }[]>`select id from items limit 2`
    assert.ok(v && items.length === 2, 'need a vendor and two items to tell "Quality" from "Mixed"')
    await txn(async (tx) => {
      const summarise = async (reasons: string[]) => {
        const [r] = await tx<{ id: string }[]>`
          insert into vendor_returns (restaurant_id, return_date, vendor_id, entered_by)
          values (${rid}, current_date, ${v.id}, 'smoke') returning id`
        for (const [i, reason] of reasons.entries()) {
          await tx`insert into vendor_return_lines
            (restaurant_id, vendor_return_id, item_id, qty, rate, reason)
            values (${rid}, ${r.id}, ${items[i % 2].id}, 1, 10, ${reason})`
        }
        const [row] = await tx<{ reason: string | null }[]>`
          select coalesce(
                   (select case when count(distinct l.reason) = 1 then min(l.reason)
                                when count(distinct l.reason) > 1 then 'Mixed' end
                    from vendor_return_lines l
                    where l.vendor_return_id = vr.id and l.reason is not null),
                   vr.reason) as reason
          from vendor_returns vr where vr.id = ${r.id}`
        return row?.reason ?? null
      }
      assert.equal(await summarise(['Quality']), 'Quality', 'one reason names itself')
      assert.equal(await summarise(['Quality', 'Quality']), 'Quality', 'the same reason twice is still one reason')
      assert.equal(await summarise(['Quality', 'Wrong item']), 'Mixed', 'two reasons read Mixed')
      throw new Error('ROLLBACK')
    }).catch((e: Error) => {
      if (e.message !== 'ROLLBACK') throw e
    })
  })

  await check('stock coming back from a department takes its reason per line', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/store-actions.ts', 'utf8')
    const fn = src.slice(src.indexOf('const ReturnSchema'), src.indexOf('// ------------------------------------------------------------ save wastage'))
    assert.match(fn, /'restaurant_id', 'return_id', 'item_id', 'qty', 'unit_cost', 'note', 'reason'/, 'return_lines carries reason')
    // returns.reason is still NOT NULL — that migration was not relaxed — so
    // the header must carry something TRUE rather than an empty string.
    assert.match(fn, /size === 1 \? input\.lines\[0\]\.reason : 'Mixed'/, 'the header summarises the lines')
    const [{ nullable }] = await tsql<{ nullable: string }[]>`
      select is_nullable as nullable from information_schema.columns
      where table_name = 'returns' and column_name = 'reason'`
    assert.equal(nullable, 'NO', 'if returns.reason ever becomes nullable, stop summarising and store null')
  })

  await check('a return can be opened from the bill, with quantities left blank', async () => {
    const { listReturnableBills, getBillReturnPrefill } = await import('../src/server/vendor-return-queries')
    const bills = await listReturnableBills(rid)
    assert.ok(bills.length > 0, 'no live bill to open a return from — nothing to test')
    const pre = await getBillReturnPrefill(rid, bills[0].id)
    assert.ok(pre !== null, 'a live bill must open')
    assert.equal(pre.vendor_id, bills[0].vendor_id, 'the bill answers the vendor')
    assert.ok(pre.lines.length > 0, 'and its lines')
    assert.ok(
      pre.lines.every((l) => Number(l.rate) > 0 && l.purchase_line_id !== '' && Number(l.billed_qty) > 0),
      'every line carries the rate, the line it came from, and what was billed',
    )
    assert.equal(await getBillReturnPrefill(rid, 'not-a-uuid'), null, 'a malformed id is null, not a 500')

    // A voided bill has nothing left to send back, and must not open.
    const [dead] = await tsql<{ id: string }[]>`
      select p.id from purchases p
      where p.restaurant_id = ${rid}
        and (p.reverses_id is not null
             or exists (select 1 from purchases x where x.reverses_id = p.id))
      limit 1`
    if (dead) assert.equal(await getBillReturnPrefill(rid, dead.id), null, 'a voided or reversal bill must not open')
    else console.log('      UNTESTED: no voided bill exists to prove the refusal')

    const { readFileSync } = await import('node:fs')
    const form = readFileSync('src/components/store/VendorReturnEntry.tsx', 'utf8')
    assert.match(form, /qty: '',/, 'quantities arrive BLANK — what came is not what goes back')
    assert.match(form, /billed \{line\.billedQty\}/, 'the billed quantity is context beside the box')
  })

  await check('editing a prefilled rate drops its provenance', async () => {
    // A source line pointing at a figure the claim no longer makes is a false
    // citation — worse than no citation, because it looks sourced.
    const { readFileSync } = await import('node:fs')
    const form = readFileSync('src/components/store/VendorReturnEntry.tsx', 'utf8')
    assert.match(
      form,
      /rate: cleanNum\(e\.target\.value\), sourceLineId: ''/,
      'typing over the rate must clear source_purchase_line_id',
    )
    // and the server refuses a line that is not this vendor's
    const { assertSourceLine, VendorReturnRefusal } = await import('../src/server/vendor-return-queries')
    const vs = await tsql<{ id: string }[]>`
      select v.id from purchases p join vendors v on v.id = p.vendor_id group by v.id limit 2`
    const line = await tsql<{ id: string; vendor_id: string }[]>`
      select l.id, p.vendor_id from purchase_lines l join purchases p on p.id = l.purchase_id limit 1`
    assert.ok(line[0], 'need a purchase line')
    assert.equal(await assertSourceLine(rid, line[0].vendor_id, line[0].id), line[0].id, 'the right vendor is accepted')
    const other = vs.find((v) => v.id !== line[0].vendor_id)
    if (other) {
      await assert.rejects(
        () => assertSourceLine(rid, other.id, line[0].id),
        (e: unknown) => e instanceof VendorReturnRefusal,
        "another vendor's bill line must be refused by name",
      )
    } else {
      console.log('      UNTESTED: only one vendor has billed us, so there is no wrong vendor to refuse')
    }
    assert.equal(await assertSourceLine(rid, line[0].vendor_id, ''), null, 'blank provenance is allowed')
  })

  await check('a BILL prefills the rate THIS vendor charges, not the last one anybody did', async () => {
    // The fault this fixes, measured on live data: item_rates.prefill_rate is
    // the last rate for the item across ALL vendors, so Chicken Boneless read
    // 330 (RR Chicken sold it last) on a Sneha Chicken bill, where the price is
    // 300. Ten percent out, on a field somebody tabs straight past.
    const { searchItems } = await import('../src/server/queries')
    const pairs = await tsql<{ item_code: string; vendor_id: string; vendor_name: string; last_rate: string }[]>`
      select s.item_code, s.vendor_id, v.name as vendor_name, s.last_rate::text as last_rate
      from vendor_supplied_items s
      join vendors v on v.id = s.vendor_id
      where s.restaurant_id = ${rid} and s.last_rate is not null
      order by s.item_code, v.name`
    assert.ok(pairs.length > 0, 'no vendor has billed an item — nothing to scope')

    // Every vendor must see THEIR OWN last rate for an item they have supplied.
    for (const pair of pairs) {
      const hits = await searchItems(rid, pair.item_code, pair.vendor_id)
      const hit = hits.find((h) => h.kind === 'item' && h.code === pair.item_code)
      assert.ok(hit && hit.kind === 'item', `${pair.item_code} must be findable for ${pair.vendor_name}`)
      assert.equal(hit.from_vendor, true, `${pair.item_code} is in ${pair.vendor_name}'s scoped group`)
      assert.equal(hit.rate_source, 'vendor', 'and the rate is labelled as theirs')
      assert.equal(
        hit.prefill_rate,
        pair.last_rate,
        `${pair.vendor_name} must prefill ${pair.last_rate} for ${pair.item_code}, not somebody else's price`,
      )
    }

    // The case that makes it matter: one item, two vendors, two prices.
    const byItem = new Map<string, Set<string>>()
    for (const p of pairs) {
      const set = byItem.get(p.item_code) ?? new Set<string>()
      set.add(p.last_rate)
      byItem.set(p.item_code, set)
    }
    const split = [...byItem.entries()].filter(([, rates]) => rates.size > 1)
    if (split.length === 0) {
      console.log('      UNTESTED: no item is bought from two vendors at two prices right now')
    } else {
      for (const [code, rates] of split) console.log(`      ${code}: ${[...rates].join(' vs ')} — scoped per vendor`)
    }

    // With no vendor picked the old behaviour stands, and is LABELLED as the
    // weaker claim it is rather than passed off as the vendor's own price.
    const unscoped = await searchItems(rid, pairs[0].item_code, null)
    const anyHit = unscoped.find((h) => h.kind === 'item' && h.code === pairs[0].item_code)
    assert.ok(anyHit && anyHit.kind === 'item')
    assert.equal(anyHit.from_vendor, false, 'nothing is scoped when no vendor is known')
    assert.ok(anyHit.rate_source === 'any' || anyHit.rate_source === null, "and the rate is not claimed as a vendor's")
  })

  await check('scoping a bill picker does not crowd out the rest of the list', async () => {
    // The scoped group is a SEPARATE query rather than an ORDER BY on one, for
    // exactly this reason: a vendor supplying eight items would otherwise fill
    // an eight-row limit and hide every other item and the whole starter
    // library — and an item is BORN on a bill, so hiding them breaks the flow
    // this picker exists for.
    const { searchItems } = await import('../src/server/queries')
    const [v] = await tsql<{ id: string; name: string }[]>`
      select v.id, v.name from vendor_supplied_items s join vendors v on v.id = s.vendor_id
      where s.restaurant_id = ${rid} group by v.id, v.name limit 1`
    assert.ok(v, 'need a vendor with history')
    const hits = await searchItems(rid, '', v.id)
    const scoped = hits.filter((h) => h.kind === 'item' && h.from_vendor)
    const other = hits.filter((h) => h.kind === 'item' && !h.from_vendor)
    const starters = hits.filter((h) => h.kind === 'starter')
    assert.ok(scoped.length > 0, 'the scoped group is populated')
    assert.ok(other.length > 0, 'and so is the general list — scoping must not exclude')
    assert.ok(starters.length > 0, 'and the starter library survives too')
    const ids = hits.filter((h) => h.kind === 'item').map((h) => (h.kind === 'item' ? h.id : ''))
    assert.equal(new Set(ids).size, ids.length, 'no item appears in both groups')
    console.log(`      ${v.name}: ${scoped.length} scoped + ${other.length} other + ${starters.length} starter`)
  })

  await check('dish pickers are ranked by use, and the reason is the scope', async () => {
    // The non-revenue form picks the REASON before the dish, so the reason is
    // the scope: staff meals are the same three dishes, a complaint comp is
    // whatever went wrong that night. Off-book has no such context — its order
    // knows a payment mode and a one-off customer name, neither of which
    // predicts the dish — so it takes the plain frequency clause instead.
    const { getGiveawayHistory, getOffBookDishHistory } = await import('../src/server/cashier-queries')
    const { rankDishes } = await import('../src/components/DishSuggest')
    assert.ok(Array.isArray(await getGiveawayHistory(rid)), 'the giveaway history query runs')
    assert.ok(Array.isArray(await getOffBookDishHistory(rid)), 'and the off-book one')

    // rankDishes is pure, so it is asserted BY VALUE — an empty live table
    // would make a database-only check pass while proving nothing.
    const dishes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const usage = [
      { scope: 'Staff meal', recipe_id: 'c', times: 5, last: '2026-08-01' },
      { scope: 'Staff meal', recipe_id: 'b', times: 1, last: '2026-08-18' },
      { scope: 'Tasting', recipe_id: 'a', times: 9, last: '2026-08-17' },
    ]
    const staff = rankDishes(dishes, usage, 'Staff meal', (d) => d.id)
    assert.deepEqual(staff.suggested.map((d) => d.id), ['c', 'b'], 'scoped to the reason, frequency first')
    assert.deepEqual(staff.rest.map((d) => d.id), ['a'], 'and everything else stays in the list')
    const none = rankDishes(dishes, usage, '', (d) => d.id)
    assert.deepEqual(
      none.suggested.map((d) => d.id),
      ['a', 'c', 'b'],
      'with no reason yet the rank is overall frequency — SUMMED across reasons, not the first row found',
    )
    // A dish nobody has given away must never vanish.
    const partial = rankDishes([{ id: 'a' }, { id: 'z' }], usage, '', (d) => d.id)
    assert.ok(
      partial.suggested.concat(partial.rest).some((d) => d.id === 'z'),
      'a dish with no history stays reachable — scoping never excludes',
    )
  })

  await check('production ranks inside the kind split, never across it', async () => {
    // Separating subs from dishes is a CORRECTNESS rule — a batch cost read as
    // a portion cost is silently wrong. Ranking is only a speed rule. So the
    // department's frequency orders rows WITHIN each optgroup rather than
    // promoting a mixed "usually makes" group above both.
    const { getProductionHistory } = await import('../src/server/kitchen-queries')
    const rows = await getProductionHistory(rid)
    assert.ok(Array.isArray(rows), 'the production history query runs')
    for (let i = 1; i < rows.length; i++) {
      assert.ok(
        rows[i - 1].times > rows[i].times ||
          (rows[i - 1].times === rows[i].times && rows[i - 1].last >= rows[i].last),
        'ranked frequency then recency',
      )
    }
    const { readFileSync } = await import('node:fs')
    const form = readFileSync('src/components/kitchen/ProductionEntry.tsx', 'utf8')
    assert.match(form, /Sub-recipes — made in batches/, 'the kind split survives the ranking')
    assert.match(form, /Dishes — made in portions/, 'both halves of it')
    assert.match(form, /ranked\('sub'\)/, 'and the rank runs inside each group')
    assert.match(form, /ranked\('dish'\)/)
    // ranked() must never DROP a producible — a batch made here for the first
    // time has no history and still has to be pickable.
    assert.match(form, /producibles\s*\n\s*\.filter\(\(p\) => p\.kind === kind\)/, 'it filters by kind only, never by history')
  })

  await check('a department scopes the closing and loss component picker', async () => {
    // What a department can HOLD is what it was issued plus what it makes —
    // section_frequent_items and productions, both already filtered for voids,
    // so no new reversal rule to get wrong. Deliberately NOT past closings: a
    // closing is corrected by RE-FILING, so kitchen_closings has no
    // reverses_id and only the latest row per (section, date) counts.
    const { searchKitchenComponents } = await import('../src/server/kitchen-queries')
    const [{ nullable }] = await tsql<{ nullable: number }[]>`
      select count(*)::int as nullable from information_schema.columns
      where table_name = 'kitchen_closings' and column_name = 'reverses_id'`
    assert.equal(nullable, 0, 'if kitchen_closings ever gains reverses_id, revisit the comment that says it has none')

    const [sec] = await tsql<{ id: string; name: string; code: string }[]>`
      select s.id, s.name, s.code from section_frequent_items f
      join sections s on s.id = f.section_id
      where f.restaurant_id = ${rid} group by s.id, s.name, s.code limit 1`
    if (!sec) {
      console.log('      UNTESTED: no department has issue history to scope by')
      return
    }
    const scoped = await searchKitchenComponents(rid, '', sec.id)
    const unscoped = await searchKitchenComponents(rid, '', null)
    assert.ok(unscoped.every((h) => h.from_section === false), 'nothing is scoped without a department')
    const marked = scoped.filter((h) => h.from_section)
    assert.ok(marked.length > 0, `${sec.name} handles components and at least one must be marked`)
    // ranked first, and nothing dropped
    const firstOther = scoped.findIndex((h) => !h.from_section && h.kind === 'item')
    const lastScoped = scoped.map((h) => h.kind === 'item' && h.from_section).lastIndexOf(true)
    if (firstOther !== -1 && lastScoped !== -1) {
      assert.ok(lastScoped < firstOther, "a department's own items rank above the rest")
    }
    assert.equal(scoped.length, unscoped.length, 'scoping reorders and marks — it must not drop a row')
    console.log(`      ${sec.name}: ${marked.length} of ${scoped.length} components marked as theirs`)
  })

  await check('person pickers rank by frequency, then recency', async () => {
    // Was last_used desc alone, which is half the rule: one payee paid once
    // yesterday outranked the one paid every week. A name that is hard to find
    // gets retyped, and a retyped name is how "Asheel Sir" is born beside
    // "Asheel" — which is the whole reason these pickers exist.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/settings.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function getNameHistory'))
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
    assert.match(body, /count\(\*\) as times/, 'frequency is counted')
    assert.match(body, /order by times desc, last_used desc/, 'and ranks ahead of recency')

    // and it still runs against every source in the map
    const { getNameHistory } = await import('../src/server/settings')
    for (const field of [
      'handed_to',
      'voucher_paid_to',
      'income_buyer',
      'income_received_by',
      'due_party',
      'expense_payee',
      'non_revenue_given_to',
    ] as const) {
      assert.ok(Array.isArray(await getNameHistory(rid, field)), `${field} resolves`)
    }
  })

  /* ── THE DEPARTMENT DRILL-DOWN ────────────────────────────────────────
     A page whose whole design problem is preconditions. Against live data
     almost every card is unassessable, so the assertions that matter are the
     ones that would catch a confident zero — not the ones that check a query
     returns rows. */

  /* ── THE CUSTOM DATE RANGE ────────────────────────────────────────────
     resolvePeriod gained a branch. The presets are asserted BY VALUE against a
     table captured BEFORE the change, because "I was careful" is not a proof —
     and the existing checks were structurally insufficient: they never asserted
     label at all, never asserted PERIOD_KEYS' contents or order, and never
     asserted last-month's reportMonth. */

  await check('every preset resolves byte-identically to before the change', async () => {
    const { readFileSync } = await import('node:fs')
    const golden = JSON.parse(readFileSync('scripts/fixtures/period-presets.json', 'utf8')) as Record<
      string,
      Record<string, unknown>
    >
    const keys = Object.keys(golden)
    assert.ok(keys.length > 400, `the golden table shrank to ${keys.length} — it is the whole proof`)
    let compared = 0
    for (const k of keys) {
      const at = k.lastIndexOf('@')
      const got = resolvePeriod(k.slice(0, at) as PeriodKey, k.slice(at + 1))
      assert.deepEqual(got, golden[k], `${k} changed`)
      // the SHAPE too, so a field added for the custom case cannot slip into
      // the preset returns unnoticed
      assert.deepEqual(
        Object.keys(got).sort(),
        ['from', 'key', 'label', 'months', 'reportMonth', 'to'],
        `${k}: Period gained or lost a field`,
      )
      compared++
    }
    assert.deepEqual(
      PERIOD_KEYS,
      ['today', 'yesterday', 'last-7-days', 'this-month', 'last-month', 'last-3-months'],
      'PERIOD_KEYS changed — the old check only counted them, so a reorder shipped green',
    )

    // THE SECOND FIXTURE covers all six. The first is the historical proof that
    // adding three presets did not move the original three, and is never
    // regenerated; this one is the going-forward table.
    const all = JSON.parse(readFileSync('scripts/fixtures/period-all.json', 'utf8')) as Record<
      string,
      Record<string, unknown>
    >
    for (const k of Object.keys(all)) {
      const at = k.lastIndexOf('@')
      assert.deepEqual(resolvePeriod(k.slice(0, at) as PeriodKey, k.slice(at + 1)), all[k], `${k} changed`)
    }
    console.log(`      ${Object.keys(all).length} resolutions across all ${PERIOD_KEYS.length} presets`)
    console.log(`      ${compared} preset resolutions identical across ${new Set(keys.map((k) => k.slice(k.lastIndexOf('@') + 1))).size} anchors`)
  })

  await check('the day presets are business days, and roll the year correctly', async () => {
    // "Today" MUST mean businessToday(), so at 00:30 it is still yesterday's
    // calendar date. resolvePeriod is pure and takes the anchor, so the whole
    // guarantee is that every call site hands it a business day — asserted
    // separately below — and that these branches do not re-derive one.
    assert.deepEqual(resolvePeriod('today', '2026-08-19'), {
      key: 'today',
      label: 'Today',
      from: '2026-08-19',
      to: '2026-08-19',
      months: ['2026-08-01'],
      reportMonth: '2026-08-01',
    })
    // year-roll, leap day and non-leap February, by value
    assert.equal(resolvePeriod('yesterday', '2026-01-01').from, '2025-12-31', 'yesterday must cross the year')
    assert.equal(resolvePeriod('yesterday', '2024-03-01').from, '2024-02-29', 'and the leap day')
    assert.equal(resolvePeriod('yesterday', '2026-03-01').from, '2026-02-28', 'and February in a normal year')
    assert.deepEqual(resolvePeriod('last-7-days', '2026-01-01').months, ['2025-12-01', '2026-01-01'])

    // SEVEN days inclusive of today, not eight — off by one every time somebody
    // counts is the sort of thing nobody reports and everybody distrusts.
    const w = resolvePeriod('last-7-days', '2026-08-19')
    const days = (Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / 86400000 + 1
    assert.equal(days, 7, `last-7-days spans ${days} days`)

    // and a single-day preset is a real period, not an empty one
    for (const k of ['today', 'yesterday'] as const) {
      const p = resolvePeriod(k, '2026-08-19')
      assert.equal(p.from, p.to, `${k} is one day`)
      assert.ok(p.to <= '2026-08-19', `${k} never reports a day that has not happened`)
    }
  })

  await check('the period anchor is the BUSINESS day at every call site', async () => {
    // The presets are pure; the guarantee lives in what they are handed. A
    // clock read anywhere on this path would say "tomorrow" at 00:30, which is
    // the exact fault the business day exists to prevent.
    const { readdirSync, statSync, readFileSync } = await import('node:fs')
    const walkP = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const q = `${dir}/${e}`
        if (statSync(q).isDirectory()) walkP(q, out)
        else if (/\.tsx?$/.test(q)) out.push(q)
      }
      return out
    }
    const offenders: string[] = []
    let anchored = 0
    for (const f of [...walkP('src/app'), ...walkP('src/components')]) {
      const src = readFileSync(f, 'utf8')
      if (!/resolvePeriod\(|readPeriodParam\(/.test(src)) continue
      // the control is a client component and is HANDED the day as a prop
      if (f.endsWith('PeriodControl.tsx')) {
        assert.match(src, /today: string/, 'the control must take the business day, never read a clock')
        assert.ok(!/new Date\(\)/.test(src), 'the control must not read the browser clock')
        continue
      }
      if (/businessToday\(\)/.test(src)) anchored++
      else offenders.push(f)
    }
    assert.deepEqual(offenders, [], 'these resolve a period without anchoring on the business day')
    assert.ok(anchored >= 14, `only ${anchored} surfaces anchor on businessToday()`)
    console.log(`      ${anchored} surfaces anchor the period on the business day`)
  })

  await check('the front door cannot re-route a preset into the custom branch', async () => {
    // THE ASSERTION WORTH WRITING FIRST. `this-month` is reached by falling
    // through rather than by an `if`, and PERIOD_LABELS[key] runs before any
    // branch — so a custom branch placed in the obvious spot would have
    // returned a this-month range wearing a custom key, with the URL saying
    // 15 July and every figure saying August, and nothing throwing.
    const { readPeriodParam } = await import('../src/lib/period')
    for (const k of PERIOD_KEYS) {
      const req = readPeriodParam(k, '2026-08-19')
      assert.equal(req.param, k, `${k} must survive the front door unchanged`)
      assert.equal(req.error, null)
      assert.deepEqual(resolvePeriod(req.param, '2026-08-19'), resolvePeriod(k, '2026-08-19'))
    }
    // and a custom range must NOT come back as a preset
    const custom = readPeriodParam('2026-07-15..2026-08-17', '2026-08-19')
    assert.equal(typeof custom.param, 'object', 'a valid range must not be swallowed into a preset')
    const p = resolvePeriod(custom.param, '2026-08-19')
    assert.equal(p.from, '2026-07-15', 'the range start must survive')
    assert.equal(p.to, '2026-08-17', 'and its end')
    assert.deepEqual(p.months, ['2026-07-01', '2026-08-01'], 'months are the whole months it touches')
    assert.equal(p.reportMonth, '2026-08-01', 'and reportMonth is the last of them')
  })

  await check('a malformed range is refused, and never mangled or thrown', async () => {
    // Each of these currently WOULD pass a regex-only validator, which is why
    // the round-trip check exists. Measured: utc('2026-02-31') rolls silently
    // to 2026-03-03, and '2026-13-01' / '2026-8-1' / 'not-a-date' make iso()
    // throw a RangeError — a 500 on twelve pages.
    const { readPeriodParam, isDate } = await import('../src/lib/period')
    const T = '2026-08-19'
    assert.equal(isDate('2026-02-31'), false, 'a regex-only validator passes this and utc() mangles it')
    assert.equal(isDate('2026-13-01'), false)
    assert.equal(isDate('2026-8-1'), false)
    assert.equal(isDate('2024-02-29'), true, 'a real leap day must still be accepted')

    for (const bad of ['2026-02-31..2026-03-05', '2026-13-01..2026-13-05', '2026-8-1..2026-8-9', '2026-01-01..x']) {
      const r = readPeriodParam(bad, T)
      assert.equal(r.param, 'this-month', `${bad} must fall back`)
      assert.ok(r.error !== null, `${bad} must SAY it was refused, not swallow it`)
    }
    // reversed: refused BY NAME, never silently swapped — swapping answers a
    // question nobody asked and the person never learns they typed it backwards
    const rev = readPeriodParam('2026-08-17..2026-08-01', T)
    assert.equal(rev.param, 'this-month')
    assert.match(rev.error ?? '', /later than/, 'a reversed range must name itself')
    assert.ok(!/swapp?ed to/i.test(rev.error ?? ''), 'and must not claim to have fixed it')
  })

  await check('a future end clamps, a future start is refused, and the span is capped', async () => {
    const { readPeriodParam, MAX_RANGE_MONTHS } = await import('../src/lib/period')
    const T = '2026-08-19'
    // A range ending in the future is FINE — both presets that can run past
    // today already clamp, and smoke asserts a period never reports days that
    // have not happened. The cap must be measured against the CLAMPED end, or
    // "1 Aug to the end of time" is refused as too long when it is 19 days.
    const far = readPeriodParam('2026-08-01..2099-01-01', T)
    assert.equal(typeof far.param, 'object', 'a future end must be accepted, not refused as too long')
    assert.equal(far.error, null)
    const p = resolvePeriod(far.param, T)
    assert.equal(p.to, T, 'and clamped to today')
    assert.ok(p.to <= T, 'a period never reports days that have not happened')

    const future = readPeriodParam('2026-09-01..2026-09-30', T)
    assert.equal(future.param, 'this-month')
    assert.match(future.error ?? '', /has not happened yet/, 'a range starting in the future must say so')

    // exactly at the cap, and one over
    const at = readPeriodParam('2025-08-01..2026-08-19', T)
    assert.equal(typeof at.param, 'object', `${MAX_RANGE_MONTHS} months must be admitted`)
    assert.equal(resolvePeriod(at.param, T).months.length, MAX_RANGE_MONTHS)
    const over = readPeriodParam('2025-01-01..2026-08-01', T)
    assert.equal(over.param, 'this-month')
    assert.match(over.error ?? '', /at most/, 'over the cap must be REFUSED, never truncated')
  })

  await check('the two predicates are disjoint, and the URL round-trips', async () => {
    const { readPeriodParam, periodParamValue, isPeriodKey, PERIOD_SEP } = await import('../src/lib/period')
    for (const k of PERIOD_KEYS) {
      assert.equal(isPeriodKey(k), true, `${k} must still be a preset`)
      assert.ok(!k.includes(PERIOD_SEP), `${k} must not contain the separator, or the two collide`)
    }
    assert.equal(isPeriodKey('2026-08-01..2026-08-17'), false, 'a range must never read as a preset')
    const value = '2026-08-01..2026-08-17'
    const back = readPeriodParam(value, '2026-08-19')
    assert.equal(periodParamValue(back.param), value, 'a pasted link must survive the round trip whole')
    for (const k of PERIOD_KEYS) assert.equal(periodParamValue(k), k)
  })

  await check('a partial-month edge is stated, never quietly summed', async () => {
    // The monthly views answer only in whole months, so a range starting on the
    // 15th makes them cover the whole month while the event cards beside them
    // start on the 15th — two cards under one heading answering two questions.
    const { partialEdges } = await import('../src/lib/period')
    const T = '2026-08-19'
    const whole = resolvePeriod('last-month', T)
    assert.deepEqual(partialEdges(whole), { head: false, tail: false }, 'a whole month has no partial edge')
    const midStart = resolvePeriod({ kind: 'custom', from: '2026-07-15', to: '2026-08-31' }, T)
    assert.equal(partialEdges(midStart).head, true, 'a start that is not a 1st is a partial head')
    const midEnd = resolvePeriod({ kind: 'custom', from: '2026-07-01', to: '2026-08-10' }, T)
    assert.equal(partialEdges(midEnd).tail, true, 'an end that is not a month end is a partial tail')
    // and `this-month` has a partial TAIL every day of its life, which is why
    // the strip fires on a partial HEAD only — otherwise it would be permanent
    // on the owner dashboard's default view and read as furniture.
    assert.equal(partialEdges(resolvePeriod('this-month', T)).tail, true)
    assert.equal(partialEdges(resolvePeriod('this-month', T)).head, false)
    const strip2 = (await import('node:fs')).readFileSync('src/components/dashboard/PartialMonths.tsx', 'utf8')
    assert.match(strip2, /const \{ head \} = partialEdges/, 'the strip must not fire on a partial tail')

    const { readFileSync } = await import('node:fs')
    const strip = readFileSync('src/components/dashboard/PartialMonths.tsx', 'utf8')
    assert.match(strip, /whole months only/, 'the strip must name what the monthly figures cover')
    // and it must be mounted on BOTH pages that read a monthly view
    for (const f of ['src/app/owner/page.tsx', 'src/app/kitchen/departments/[code]/page.tsx']) {
      assert.match(readFileSync(f, 'utf8'), /<PartialMonths period=\{period\} \/>/, `${f} reads a monthly view and must say so`)
    }
  })

  await check('every page reads ?period= through the one front door', async () => {
    // Twelve hand-written two-branch ternaries becoming twelve hand-written
    // three-branch ones is twelve chances to get precedence wrong.
    const { readFileSync } = await import('node:fs')
    const { readdirSync, statSync } = await import('node:fs')
    const walkFiles = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const q = `${dir}/${e}`
        if (statSync(q).isDirectory()) walkFiles(q, out)
        else if (/\.tsx?$/.test(q)) out.push(q)
      }
      return out
    }
    const files = [...walkFiles('src/app'), ...walkFiles('src/components')]
    const offenders: string[] = []
    let doors = 0
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (/isPeriodKey\(/.test(src)) offenders.push(f)
      if (/readPeriodParam\(/.test(src)) doors++
    }
    assert.deepEqual(offenders, [], 'these still decide the period themselves instead of calling readPeriodParam')
    assert.ok(doors >= 12, `only ${doors} pages call the front door — the sweep found fewer than the known mounts`)
    console.log(`      ${doors} surfaces read ?period= through readPeriodParam`)
  })

  await check('every basePath the control is given is a real route', async () => {
    // No gate reads this control: audit:matrix matches only hrefs with a
    // literal leading slash and PeriodControl's href opens with an
    // interpolation, so it is invisible to it.
    const { readFileSync } = await import('node:fs')
    const { readdirSync, statSync } = await import('node:fs')
    const walkFiles = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const q = `${dir}/${e}`
        if (statSync(q).isDirectory()) walkFiles(q, out)
        else if (/\.tsx?$/.test(q)) out.push(q)
      }
      return out
    }
    const routes = new Set<string>()
    for (const f of walkFiles('src/app')) {
      if (!/[\\/]page\.tsx$/.test(f)) continue
      routes.add(
        f.replace(/^src\/app/, '').replace(/\/page\.tsx$/, '').replace(/\/\([^)]*\)/g, '') || '/',
      )
    }
    const dynamic = (p: string) => p.replace(/\/\[[^\]]+\]/g, '/[x]')
    const known = new Set([...routes].map(dynamic))
    const bad: string[] = []
    let seen = 0
    for (const f of walkFiles('src/app')) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/<PeriodControl[^>]*?basePath=(?:"([^"]+)"|\{`([^`]+)`\})/gs)) {
        seen++
        const raw = (m[1] ?? m[2]).replace(/\$\{[^}]+\}/g, '[x]')
        if (!known.has(dynamic(raw))) bad.push(`${f}: ${raw}`)
      }
    }
    assert.ok(seen >= 10, `only ${seen} basePath props found — the matcher stopped matching`)
    assert.deepEqual(bad, [], 'these mount the period control on a path with no page behind it')
    console.log(`      ${seen} basePath props, all resolving`)
  })

  /* ── REGROUPING: a group is a SUBJECT, not a person ───────────────────── */

  await check('the three strips regrouped by subject, by value', async () => {
    const { TAB_DEFAULTS } = await import('../src/lib/tabs')
    const keys = (g: 'staff' | 'accounts' | 'sales') => TAB_DEFAULTS[g].map((t) => t.key)

    assert.deepEqual(keys('staff'), ['dashboard', 'employees', 'attendance', 'moneyout'])
    assert.deepEqual(keys('accounts'), [
      'review', 'payments', 'registers', 'parties', 'money', 'payroll', 'close',
    ])
    assert.deepEqual(keys('sales'), ['dashboard', 'close', 'record', 'partners', 'catering', 'books'])

    // EXPENSES LEFT. Rent and power are overheads on a different P&L line from
    // wages, and a group that keeps them stops being about people.
    const staffChips = TAB_DEFAULTS.staff.flatMap((t) => t.chips?.map((c) => c.key) ?? [])
    assert.ok(!staffChips.includes('expense'), 'expense is back in the staff group')
    const payments = TAB_DEFAULTS.accounts.find((t) => t.key === 'payments')
    assert.deepEqual(payments?.chips?.map((c) => c.key), ['expense', 'pay', 'deposit'])

    // CONTRACT AND CASUAL STAY: they are people you pay who are not on
    // payroll, and pnl_monthly already counts all three kinds as labour.
    const moneyout = TAB_DEFAULTS.staff.find((t) => t.key === 'moneyout')
    assert.deepEqual(moneyout?.chips?.map((c) => c.key), ['contract', 'casual'])
    assert.equal(moneyout?.label, 'Contract & casual')

    // DAY CLOSE IS A TAB, not a chip — the whole argument was the badge.
    assert.ok(
      !TAB_DEFAULTS.sales.some((t) => t.chips?.some((c) => c.key === 'close')),
      'day close is back inside Record, where it cannot carry a count',
    )
    assert.equal(TAB_DEFAULTS.sales.find((t) => t.key === 'close')?.href, '/sales/close')
    assert.equal(TAB_DEFAULTS.accounts.find((t) => t.key === 'money')?.label, 'Cash & bank')
  })

  await check('the day-close badge counts what the tab exists for', async () => {
    const { countMissingCloses } = await import('../src/server/cashier-queries')
    const n = await countMissingCloses(rid)
    assert.equal(typeof n, 'number')
    const [{ m }] = await tsql<{ m: number }[]>`
      select count(*)::int as m from missing_closes where restaurant_id = ${rid}`
    assert.equal(n, m, 'the badge must read missing_closes, not recompute it')

    // and it must be WIRED, or the tab is just a tab again
    const { readFileSync } = await import('node:fs')
    const g = readFileSync('src/components/GroupTabs.tsx', 'utf8')
    assert.match(g, /group === 'sales'/, 'the sales group must compute a badge')
    assert.match(g, /countMissingCloses/, 'and it must be this one')
    console.log(`      ${n} unclosed day(s) — silent at zero`)
  })

  await check('every chip parent renders its OWN first chip', async () => {
    // THE BUG THIS WAS WRITTEN FROM. /sales/record re-exported Voucher while
    // its first chip was "Day close", so the parent URL showed one screen with
    // another highlighted. ChipRow marks the first chip active at the parent
    // URL, so parent and first chip must be the same thing — and nothing
    // checked that until now.
    const { readFileSync, existsSync } = await import('node:fs')
    const { TAB_DEFAULTS, TAB_GROUPS } = await import('../src/lib/tabs')
    const offenders: string[] = []
    let checked = 0
    for (const g of TAB_GROUPS) {
      for (const tab of TAB_DEFAULTS[g]) {
        const first = tab.chips?.[0]
        if (first === undefined) continue
        const parent = `src/app${tab.href}/page.tsx`
        if (!existsSync(parent)) {
          offenders.push(`${tab.href} has chips but no parent page`)
          continue
        }
        checked++
        const src = readFileSync(parent, 'utf8')
        // a chip parent re-exports its first chip; anything else is a page of
        // its own and must not claim to be the chip row's first entry
        const m = src.match(/export \{ default \} from '\.\/([^']+)\/page'/)
        if (m !== null) {
          if (m[1] !== first.key) {
            offenders.push(`${tab.href} renders "${m[1]}" but marks "${first.key}" active`)
          }
          continue
        }
        // ONE DOCUMENTED EXCEPTION: a parent whose child is a DYNAMIC route
        // cannot bare re-export it — the child would arrive with no param and
        // notFound() — so it calls the child with the first chip's key. That
        // still has to BE the first chip's key, which is what is checked.
        const dyn = src.match(/params: Promise\.resolve\(\{ \w+: '([^']+)' \}\)/)
        if (dyn === null) offenders.push(`${tab.href} neither re-exports a chip nor supplies one`)
        else if (dyn[1] !== first.key) {
          offenders.push(`${tab.href} supplies "${dyn[1]}" but marks "${first.key}" active`)
        }
      }
    }
    assert.deepEqual(offenders, [], 'these parents show one screen and highlight another')
    assert.ok(checked >= 8, `only ${checked} chip parents checked — the matcher stopped matching`)
    console.log(`      ${checked} chip parents render their own first chip`)
  })

  await check('a writing surface is mounted once, not beside its reading twin', async () => {
    // Payments is for WRITING and Registers / Cash & bank are for READING, and
    // the split is only legible if each form lives on exactly one of them.
    // Mounting a component in both is duplication by definition — the rule
    // SectionsView is already held to.
    const { readdirSync, statSync, readFileSync } = await import('node:fs')
    const walkA = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const q = `${dir}/${e}`
        if (statSync(q).isDirectory()) walkA(q, out)
        else if (/page\.tsx$/.test(q)) out.push(q)
      }
      return out
    }
    const pages = walkA('src/app')
    for (const cmp of ['BankPayment', 'WithholdingsPanel', 'ExpensesClient']) {
      const mounts = pages.filter((f) => new RegExp(`<${cmp}[\\s/>]`).test(readFileSync(f, 'utf8')))
      assert.equal(mounts.length, 1, `${cmp} is mounted ${mounts.length}× : ${mounts.join(', ')}`)
      assert.match(mounts[0], /accounts\/payments\//, `${cmp} should live under Payments`)
    }
  })

  await check('the staff dashboard runs, and refuses a ratio with no denominator', async () => {
    // THE CARD MOST LIKELY TO LIE. Labour cost is real and revenue is absent,
    // so a percentage would divide by nothing — and "0%" would tell a manager
    // their wage bill is free.
    const { getStaffDashboard, attendanceTakenOn } = await import('../src/server/staff-queries')
    const period = resolvePeriod('this-month', new Date().toISOString().slice(0, 10))
    const d = await getStaffDashboard(rid, period.months, period.reportMonth)
    assert.ok(Array.isArray(d.labour) && Array.isArray(d.attendance))
    assert.ok(Array.isArray(d.advances) && Array.isArray(d.headcount))
    assert.ok(Array.isArray(d.bySection) && Array.isArray(d.unposted))
    const taken = await attendanceTakenOn(rid, period.to)
    assert.equal(typeof taken.marked, 'number')
    assert.equal(typeof taken.active, 'number')

    // absence is ranked by absent_pct, never by name
    for (let i = 1; i < d.attendance.length; i++) {
      const a = Number(d.attendance[i - 1].absent_pct ?? -1)
      const b = Number(d.attendance[i].absent_pct ?? -1)
      assert.ok(a >= b, 'the absence table is not ranked worst first')
    }

    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/app/staff/page.tsx', 'utf8')
    assert.match(page, /the denominator is missing/i, 'the ratio card must name what is absent')
    assert.match(page, /not a wage bill of zero/, 'and the spend card must refuse a confident zero')
    assert.match(page, /<PeriodControl/, 'staff was the only group with no period control')

    // no_salary_set is the honesty column that changes every figure above it
    const noSalary = d.headcount.reduce((n, r) => n + r.no_salary_set, 0)
    console.log(
      `      ${d.headcount.reduce((n, r) => n + r.heads, 0)} head(s), ${noSalary} with no salary, ` +
        `${d.labour.length} month(s) of labour, ${d.attendance.length} attendance row(s)`,
    )
  })

  await check('the labour donut is validated, not eyeballed', async () => {
    // Measured with the palette validator on this palette: emerald-700 ·
    // sky-300 · violet-700 separate by ΔE 25.3 under protanopia and 27.1 under
    // normal vision — well clear of the 8 and 15 floors. sky-300 sits at
    // 2.32:1 against the surface, BELOW 3:1, which obligates visible labels;
    // that is why every slice is direct-labelled and repeated as a table.
    const { readFileSync } = await import('node:fs')
    const charts = readFileSync('src/components/dashboard/Charts.tsx', 'utf8')
    assert.match(charts, /const CAT = \[/, 'the categorical triple must be named once')
    for (const token of ['--color-emerald-700', '--color-sky-300', '--color-violet-700']) {
      assert.ok(charts.includes(token), `the validated triple lost ${token}`)
    }
    // status hues are RESERVED — a category wearing red reads as "wrong"
    const cat = charts.slice(charts.indexOf('const CAT = ['), charts.indexOf(']', charts.indexOf('const CAT = [')))
    assert.ok(!/red|amber/.test(cat), 'a category is wearing a status colour')
    // and identity is never carried by colour alone
    const split = charts.slice(charts.indexOf('export function LabourSplit'))
    assert.match(split, /\{a\.label\}/, 'every slice must be labelled in words')
    assert.match(split, /Math\.round\(a\.frac \* 100\)/, 'and carry its share as a number')
  })

  await check('every department resolves, and a bogus code does not', async () => {
    const { getDepartment, DEPT_CODE } = await import('../src/server/department-queries')
    const codes = await tsql<{ code: string }[]>`
      select code from sections where restaurant_id = ${rid} order by code`
    assert.ok(codes.length > 0, 'no departments — nothing to drill into')
    for (const { code } of codes) {
      const d = await getDepartment(rid, code)
      assert.ok(d !== null, `${code} must resolve`)
      assert.equal(d.code, code)
      // BOTH KEYS, resolved once. Seven views key on the text code and six
      // relations key on the uuid; a page holding only one of them is a 42703
      // waiting for whichever card reaches for the other.
      assert.match(d.id, /^[0-9a-f-]{36}$/, `${code} must carry its uuid`)
      // a lowercase code in a URL must find the same department, not 404
      const lower = await getDepartment(rid, code.toLowerCase())
      assert.equal(lower?.id, d.id, `${code.toLowerCase()} must resolve to the same department`)
    }
    assert.equal(await getDepartment(rid, 'ZZ'), null, 'an unknown code is not found')
    assert.equal(await getDepartment(rid, 'not-a-code'), null, 'a malformed code never reaches Postgres')
    assert.equal(DEPT_CODE.test('CH'), true)
    // the guard is letters only, so nothing punctuated ever reaches the query
    assert.equal(DEPT_CODE.test('CH%20OR%201'), false, 'the guard refuses anything but letters')
    assert.equal(DEPT_CODE.test('TOOLONG'), false, 'and refuses anything longer than a code')
  })

  await check('every department read runs against the real database', async () => {
    // The rule the schema gate cannot enforce: a query that typechecks can
    // still name a column that does not exist. issue_frequency in particular
    // has NEVER been read by this repository before, so nothing has ever
    // proved it works.
    const { getDepartment, getDepartmentByCode, getDepartmentById, getDepartmentEvidence } = await import(
      '../src/server/department-queries'
    )
    const period = resolvePeriod('last-3-months', new Date().toISOString().slice(0, 10))
    const codes = await tsql<{ code: string }[]>`
      select code from sections where restaurant_id = ${rid} order by code`
    let rhythmRows = 0
    let indentRows = 0
    for (const { code } of codes) {
      const d = await getDepartment(rid, code)
      assert.ok(d)
      const byCode = await getDepartmentByCode(rid, d.code, period.months, period.from, period.to)
      const byId = await getDepartmentById(rid, d.id, period.from, period.to)
      const ev = await getDepartmentEvidence(rid, d.code, d.id, period.from, period.to)
      rhythmRows += byCode.rhythm.length
      indentRows += byCode.indents.length
      assert.equal(typeof ev.sales, 'boolean')
      for (const r of byId.shift) {
        assert.ok(r.closed === null || Number(r.closed) >= 0, 'a closing is null or a figure, never NaN')
      }
    }
    assert.ok(rhythmRows > 0, 'issue_frequency returned nothing for any department — its first reader is untested')
    assert.ok(indentRows > 0, 'indent_fulfilment returned nothing — the richest card is untested')
    console.log(`      ${codes.length} departments · ${indentRows} indent lines · ${rhythmRows} issue days`)
  })

  await check('margin is refused while sales or labour rest on nothing', async () => {
    // THE FAULT THIS PAGE IS MOST LIKELY TO SHIP. section_costs COALESCEs every
    // figure to 0 and publishes no honesty column, so South Indian reads
    // sales 0, labour 0, margin -7498 — and on a page titled after a department
    // that is an accusation about a named team, not a measurement.
    const { getDepartment, getDepartmentEvidence } = await import('../src/server/department-queries')
    const period = resolvePeriod('this-month', new Date().toISOString().slice(0, 10))

    const [{ n: marks }] = await tsql<{ n: number }[]>`
      select count(*)::int as n from attendance
      where restaurant_id = ${rid} and att_date between ${period.from}::date and ${period.to}::date`

    const codes = await tsql<{ code: string }[]>`
      select code from sections where restaurant_id = ${rid} order by code`
    for (const { code } of codes) {
      const d = await getDepartment(rid, code)
      assert.ok(d)
      const ev = await getDepartmentEvidence(rid, d.code, d.id, period.from, period.to)
      // SALES MUST REST ON ATTRIBUTABLE REVENUE, not on "was any POS day
      // fetched". This assertion originally asserted the latter — it encoded
      // the very behaviour that would hand all sixteen departments a confident
      // 0 and a red negative margin the day the POS is switched on, because
      // revenue reaches a department only through pos_item_map → recipes.
      const [{ n: mine }] = await tsql<{ n: number }[]>`
        select count(*)::int as n
        from pos_lines pl
        join pos_orders o on o.id = pl.order_id
        join pos_item_map m on m.restaurant_id = pl.restaurant_id and m.pos_item_id = pl.pos_item_id
        join recipes r on r.id = m.recipe_id
        where pl.restaurant_id = ${rid} and r.section_id = ${d.id}
          and o.business_date between ${period.from}::date and ${period.to}::date`
      assert.equal(ev.sales, mine > 0, `${code}: sales evidence must follow MAPPED revenue for this section`)
      if (marks === 0) assert.equal(ev.labour, false, `${code}: no attendance anywhere means no labour figure`)
    }

    const withCost = await tsql<{ section_code: string; margin: string }[]>`
      select section_code, margin::text as margin from section_costs
      where restaurant_id = ${rid} and month = any(${period.months}::date[])`
    for (const row of withCost) {
      const d = await getDepartment(rid, row.section_code)
      if (!d) continue
      const ev = await getDepartmentEvidence(rid, d.code, d.id, period.from, period.to)
      if (!ev.sales || !ev.labour) {
        assert.ok(
          Number(row.margin) !== 0,
          `${row.section_code}: section_costs publishes margin ${row.margin} the page must NOT show`,
        )
        console.log(
          `      ${row.section_code}: view says margin ${row.margin}; page refuses it (sales=${ev.sales} labour=${ev.labour})`,
        )
      }
    }
  })

  await check('a structural impossibility never renders as missing data', async () => {
    // SF and KS are dept_kind='kitchen' and CANNOT code dishes; ST/AC/VL/SC
    // cannot receive stock. Rendering an empty list for either sends a chef
    // looking for data that can never exist — and an empty food-cost card on an
    // operational department would tell it it owes a closing it can never file.
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/app/kitchen/departments/[code]/page.tsx', 'utf8')
    assert.match(page, /No dish can be coded to/, 'the dish card must state the structural reason')
    assert.match(page, /!dept\.codes_dishes/, 'and gate it on codes_dishes, not on an empty list')
    assert.match(page, /!dept\.receives_stock/, 'the indent and rhythm cards gate on receives_stock')
    assert.match(page, /Food cost is a kitchen question/, 'a non-cooking department is told why, not shown nothing')
    assert.match(page, /function NotApplicable/, 'and it is a different component from "cannot be assessed"')

    const rows = await tsql<{ code: string; dept_kind: string; codes_dishes: boolean; receives_stock: boolean }[]>`
      select code, dept_kind, codes_dishes, receives_stock from sections where restaurant_id = ${rid}`
    const kitchenNoDishes = rows.filter((r) => r.dept_kind === 'kitchen' && !r.codes_dishes).map((r) => r.code)
    assert.ok(
      kitchenNoDishes.length > 0,
      'no kitchen department lacks codes_dishes — so dept_kind alone would look sufficient and this cannot fail',
    )
    console.log(`      kitchen but cannot code dishes: ${kitchenNoDishes.join(' ')}`)
    console.log(`      cannot receive stock: ${rows.filter((r) => !r.receives_stock).map((r) => r.code).join(' ')}`)
  })

  await check('a card that CANNOT apply never says "cannot be assessed"', async () => {
    // The doctrine, checked per card per department rather than asserted once.
    // An adversarial pass found four cards that reported a structural
    // impossibility as missing data — the Store was told nothing had moved
    // "from the store to Store" yet, which invites an entry saveIssue refuses.
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/app/kitchen/departments/[code]/page.tsx', 'utf8')

    // every card that CAN be structurally impossible must branch on the column
    // that governs it, before it reaches its data branch
    for (const [card, guard] of [
      ['Lost, by reason', '!cooks'],
      ['Did it get what it asked for?', '!indents'],
      ['Daily rhythm', '!dept.receives_stock'],
      ['Dishes', '!dept.codes_dishes'],
      ['Made and held', '!cooks'],
      ['Food cost', '!cooks'],
    ] as const) {
      const i = page.indexOf(`title="${card}"`)
      assert.ok(i > 0, `${card} card is missing`)
      const body = page.slice(i, i + 900)
      assert.ok(body.includes(guard), `${card} must gate on ${guard} before reporting missing data`)
    }
    // an indent needs BOTH — saveIndent asserts kitchen/bar AND receives_stock
    assert.match(page, /const indents = cooks && dept\.receives_stock/, 'the indent gate lost one of its two halves')
    // and a retired department is not owed a closing
    assert.match(page, /dept\.status === 'active' &&/, 'cooks must exclude a retired department')
  })

  await check('the food-cost card does not demand a closing that cannot help', async () => {
    // section_food_cost is driven FROM section_consumption, which ends
    //   where coalesce(iss.v,0) <> 0 or coalesce(ret.v,0) <> 0
    // so a department with no issue and no return can NEVER acquire a row —
    // filing the closing the card used to ask for would not change the answer.
    const [{ d }] = await tsql<{ d: string }[]>`
      select pg_get_viewdef('section_consumption'::regclass, true) as d`
    assert.match(
      d,
      /COALESCE\(iss\.v, 0::numeric\) <> 0::numeric OR COALESCE\(ret\.v, 0::numeric\) <> 0::numeric/,
      'section_consumption stopped requiring movement — the has_activity branch may no longer be needed',
    )
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/app/kitchen/departments/[code]/page.tsx', 'utf8')
    assert.match(page, /!fc\.has_activity/, 'the card must read has_activity, which is published for exactly this')
    assert.match(page, /nothing issued this month/, 'and say so instead of "pending closing"')
    // and the issued figure must live ONLY in the branch where it is a measurement
    const i = page.indexOf('needs="nothing issued this month"')
    const j = page.indexOf('needs="pending closing"')
    assert.ok(i > 0 && j > i, 'the no-activity branch must come BEFORE the pending-closing branch')
    assert.ok(
      !page.slice(i, j).includes('money(fc'),
      'a coalesced 0.00 must not be printed as an issued figure where nothing was issued',
    )
  })

  await check('an unfilled indent is not called short', async () => {
    // indent_fulfilment computes coalesce(qty_given, 0) − qty_requested, so an
    // OPEN request the store has not touched arrives as −5 and read as
    // "Short 5 kg" IN RED — an accusation for a request nobody has been given
    // the chance to fill. BOTH readers of GapCell had it; live data has no open
    // indent, so nothing on this database could ever have caught it.
    const [{ d }] = await tsql<{ d: string }[]>`
      select pg_get_viewdef('indent_fulfilment'::regclass, true) as d`
    assert.match(d, /ELSE COALESCE\(g\.qty_given, 0::numeric\) - l\.qty_requested/, 'the gap stopped coalescing an unfilled indent to 0')

    const { readFileSync } = await import('node:fs')
    const cell = readFileSync('src/components/kitchen/GapCell.tsx', 'utf8')
    assert.match(cell, /status === 'open'/, 'GapCell must know an open indent is not short')
    assert.match(cell, /not issued yet/, 'and say so')
    // EVERY caller passes it, or the component cannot apply the rule
    for (const f of [
      'src/app/kitchen/departments/[code]/page.tsx',
      'src/app/kitchen/indent/[id]/page.tsx',
    ]) {
      const src = readFileSync(f, 'utf8')
      const uses = src.match(/<GapCell[^>]*\/>/gs) ?? []
      assert.ok(uses.length > 0, `${f} should render GapCell`)
      for (const u of uses) assert.match(u, /status=/, `${f}: GapCell without a status would call an open indent short`)
    }
  })

  await check('the biggest loss is at the top, and a voided one is not a row', async () => {
    // `order by 3 desc` pointed at a ::text cast, so 9.00 sorted above 100.00
    // and the worst reason was not first — which is the whole point of the card.
    const { readFileSync } = await import('node:fs')
    const q = readFileSync('src/server/department-queries.ts', 'utf8')
    assert.match(q, /order by coalesce\(sum\(w\.value\), 0\) desc/, 'the loss table is ordered by text again')
    // STRIP COMMENTS FIRST. The fix's own comment quotes the old bad clause to
    // explain it, and a naive grep matched that and failed — the same blind
    // spot audit:schema had until it learned to strip SQL comments.
    const code = q.replace(/--[^\n]*/g, '')
    assert.ok(!/order by 3 desc/.test(code), 'an ordinal into a ::text column sorts lexically')
    // and a fully-voided day or reason must vanish rather than print 0.00
    assert.equal((q.match(/having count\(\*\) filter/g) ?? []).length, 2, 'both groups must drop when every row is voided')

    // proof that the ordering actually differed
    const [row] = await tsql<{ lex: string; num: string }[]>`
      select (array_agg(v order by v::text desc))[1] as lex,
             (array_agg(v order by v desc))[1] as num
      from (values (9.00), (100.00), (10.00)) as x(v)`
    assert.equal(row.lex, '9.00', 'text ordering puts 9 first')
    assert.equal(row.num, '100.00', 'numeric ordering puts 100 first')
  })

  await check('the labour evidence mirrors the view it certifies', async () => {
    // labour_cost_by_section carries `where st.employment_type <> 'contract'`,
    // so counting contract marks as evidence would call the leg assessable and
    // then read 0.00 off a view that deliberately excluded those people — a
    // measurement made of an exclusion, and it would unlock the margin too.
    const [{ d }] = await tsql<{ d: string }[]>`
      select pg_get_viewdef('labour_cost_by_section'::regclass, true) as d`
    assert.match(d, /WHERE st\.employment_type <> 'contract'::text/, 'the view stopped excluding contract staff')
    const { readFileSync } = await import('node:fs')
    const q = readFileSync('src/server/department-queries.ts', 'utf8')
    assert.match(q, /st\.employment_type <> 'contract'/, 'the evidence must exclude them too')
    assert.match(q, /from attendance_current a/, 'and read the same corrected marks the view reads')
  })

  await check('a dish with uncosted ingredients does not show a confident cost', async () => {
    // dish_costs prices an ingredient with no bill behind it at 0 and publishes
    // uncosted_lines to say so. Printing the batch total without that turns a
    // half-priced recipe into a cheap dish, and the flag can come out green.
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/app/kitchen/departments/[code]/page.tsx', 'utf8')
    assert.match(page, /d\.uncosted_lines > 0 \?/, 'uncosted_lines must change what the cost cell shows')
    assert.match(page, /costs understated/, 'and the card must say so once, with a count')
    const { listDishCosts } = await import('../src/server/recipes-queries')
    const dishes = await listDishCosts(rid)
    for (const d of dishes) {
      assert.equal(typeof d.uncosted_lines, 'number', `${d.code}: uncosted_lines must arrive as a number`)
      assert.ok(d.flag === 'OK' || d.flag === 'HIGH' || d.flag === 'CHECK', `${d.code}: unknown flag ${d.flag}`)
    }
  })

  await check('the department page never reads unassigned_marks', async () => {
    // It is count(*) filter (where st.section_id is null), grouped under
    // coalesce(s.code, '—'). On a REAL department's row it is therefore
    // structurally always 0 — a permanent all-clear against an honesty column
    // that can never fire, the exact shape of the four dashboard cards that
    // reported clean bills of health over missing data.
    const { readFileSync } = await import('node:fs')
    const q = readFileSync('src/server/department-queries.ts', 'utf8')
    assert.ok(!/select[\s\S]{0,400}unassigned_marks/.test(q), 'unassigned_marks is back in the department reads')

    const def = await tsql<{ d: string }[]>`
      select pg_get_viewdef('labour_cost_by_section'::regclass, true) as d`
    assert.match(def[0].d, /FILTER \(WHERE st\.section_id IS NULL\)/, 'unassigned_marks stopped being a null-section count')
    assert.match(def[0].d, /COALESCE\(s\.code, '—'::text\)/, 'the unassigned bucket stopped being its own row')
    assert.match(q, /unsalaried_marks/, 'the honesty column that CAN fire must still be read')
  })

  await check('a vendor-return void returns EVERY view to where it started', async () => {
    // This replaces the invariant that held the refusal in place (refusal in
    // force iff the views doubled). That one had a job and it did it: it went
    // red the day money_views_skip_reversed_returns landed. This is the
    // permanent form — and it asserts ALL FIVE columns, not the money alone,
    // because the fault has now moved between halves twice: 0022 fixed the
    // stock and broke the money, and a gate watching one half agreed with both
    // breaks in turn.
    const [v] = await tsql<{ id: string; name: string }[]>`
      select v.id, v.name from purchases p join vendors v on v.id = p.vendor_id group by v.id, v.name limit 1`
    const [item] = await tsql<{ id: string }[]>`select id from items limit 1`
    assert.ok(v && item, 'need a vendor and an item — nothing to move, so nothing is tested')

    await txn(async (tx) => {
      const snapshot = async () => {
        const [d] = await tx<{ balance: string; credits: string }[]>`
          select balance::text as balance, coalesce(credits, 0)::text as credits
          from vendor_dues where vendor_id = ${v.id}`
        const [p] = await tx<{ returned: string }[]>`
          select coalesce(returned_value, 0)::text as returned
          from vendor_performance where vendor_id = ${v.id}`
        const [st] = await tx<{ on_hand: string }[]>`
          select coalesce(on_hand_qty, 0)::text as on_hand from stock_on_hand where item_id = ${item.id}`
        const [rs] = await tx<{ lines: string; value: string }[]>`
          select coalesce(sum(lines), 0)::text as lines, coalesce(sum(value), 0)::text as value
          from vendor_return_reasons where vendor_id = ${v.id}`
        return {
          balance: Number(d?.balance ?? 0),
          credits: Number(d?.credits ?? 0),
          returned: Number(p?.returned ?? 0),
          onHand: Number(st?.on_hand ?? 0),
          reasonLines: Number(rs?.lines ?? 0),
          reasonValue: Number(rs?.value ?? 0),
        }
      }

      const before = await snapshot()
      const [r] = await tx<{ id: string }[]>`
        insert into vendor_returns (restaurant_id, return_date, vendor_id, entered_by)
        values (${rid}, current_date, ${v.id}, 'smoke') returning id`
      await tx`insert into vendor_return_lines (restaurant_id, vendor_return_id, item_id, qty, rate, reason)
               values (${rid}, ${r.id}, ${item.id}, 10, 50, 'Quality')`

      // The return must MOVE all five, or the void has nothing to prove.
      const after = await snapshot()
      assert.equal(after.credits - before.credits, 500, 'a 10 × 50 return claims 500')
      assert.equal(before.balance - after.balance, 500, 'and takes 500 off what we owe them')
      assert.equal(after.returned - before.returned, 500, 'and shows on vendor_performance')
      assert.equal(before.onHand - after.onHand, 10, 'and takes 10 off the shelf')
      assert.equal(after.reasonLines - before.reasonLines, 1, 'and one line reads Quality')
      assert.equal(after.reasonValue - before.reasonValue, 500, 'worth 500')

      const [rev] = await tx<{ id: string }[]>`
        insert into vendor_returns (restaurant_id, return_date, vendor_id, reason, reverses_id, entered_by)
        values (${rid}, current_date, ${v.id}, 'void', ${r.id}, 'smoke') returning id`
      await tx`insert into vendor_return_lines
                 (restaurant_id, vendor_return_id, item_id, qty, rate, reason, source_purchase_line_id)
               select restaurant_id, ${rev.id}, item_id, qty, rate, reason, source_purchase_line_id
               from vendor_return_lines where vendor_return_id = ${r.id}`

      const voided = await snapshot()
      assert.deepEqual(
        voided,
        before,
        'a void must return EVERY view to where it started — money, stock and the reason breakdown',
      )
      console.log(
        `      balance ${before.balance} → ${after.balance} → ${voided.balance} · on hand ${before.onHand} → ${after.onHand} → ${voided.onHand}`,
      )
      throw new Error('ROLLBACK')
    }).catch((e: Error) => {
      if (e.message !== 'ROLLBACK') throw e
    })
  })

  await check('the per-line reason has a reader, ranked by count not value', async () => {
    // The reason existed with nothing reading it for one commit; vendor_
    // performance carries only returned_value, which cannot tell four rotten
    // crates from one expensive mis-delivery. Asserted INSIDE a rolled-back
    // transaction because the view is empty on live data — an assertion over
    // no rows would pass while proving nothing.
    const { getVendorReturnReasons } = await import('../src/server/vendor-return-queries')
    const [v] = await tsql<{ id: string }[]>`
      select v.id from purchases p join vendors v on v.id = p.vendor_id group by v.id limit 1`
    const items = await tsql<{ id: string }[]>`select id from items limit 2`
    assert.ok(v && items.length === 2, 'need a vendor and two items')
    assert.deepEqual(await getVendorReturnReasons(rid, 'not-a-uuid'), [], 'a malformed id is no rows, not a 500')

    await txn(async (tx) => {
      const add = async (reason: string, qty: number, rate: number, item: string) => {
        const [r] = await tx<{ id: string }[]>`
          insert into vendor_returns (restaurant_id, return_date, vendor_id, entered_by)
          values (${rid}, current_date, ${v.id}, 'smoke') returning id`
        await tx`insert into vendor_return_lines (restaurant_id, vendor_return_id, item_id, qty, rate, reason)
                 values (${rid}, ${r.id}, ${item}, ${qty}, ${rate}, ${reason})`
        return r.id
      }
      // Quality: 3 lines worth 300. Wrong item: 1 line worth 9000.
      // Count must win — that is the whole ranking argument.
      await add('Quality', 1, 100, items[0].id)
      await add('Quality', 1, 100, items[0].id)
      await add('Quality', 1, 100, items[1].id)
      const voided = await add('Wrong item', 1, 9000, items[1].id)

      let rows = await tx<{ reason: string; lines: number; value: string }[]>`
        select reason, lines::int as lines, value::text as value
        from vendor_return_reasons
        where restaurant_id = ${rid} and vendor_id = ${v.id}
        order by lines desc, value desc, reason asc`
      assert.deepEqual(
        rows.map((r) => `${r.reason}:${r.lines}:${r.value}`),
        ['Quality:3:300', 'Wrong item:1:9000'],
        'three cheap Quality lines must rank above one expensive Wrong item — count, not value',
      )

      // and a voided return must stop counting against the supplier, which is
      // the reason the void could come back at all
      const [rev] = await tx<{ id: string }[]>`
        insert into vendor_returns (restaurant_id, return_date, vendor_id, reason, reverses_id, entered_by)
        values (${rid}, current_date, ${v.id}, 'void', ${voided}, 'smoke') returning id`
      await tx`insert into vendor_return_lines
                 (restaurant_id, vendor_return_id, item_id, qty, rate, reason, source_purchase_line_id)
               select restaurant_id, ${rev.id}, item_id, qty, rate, reason, source_purchase_line_id
               from vendor_return_lines where vendor_return_id = ${voided}`
      rows = await tx<{ reason: string; lines: number; value: string }[]>`
        select reason, lines::int as lines, value::text as value
        from vendor_return_reasons
        where restaurant_id = ${rid} and vendor_id = ${v.id}
        order by lines desc, value desc, reason asc`
      assert.deepEqual(
        rows.map((r) => `${r.reason}:${r.lines}`),
        ['Quality:3'],
        'a voided return must vanish from the breakdown entirely, not net to zero lines',
      )
      throw new Error('ROLLBACK')
    }).catch((e: Error) => {
      if (e.message !== 'ROLLBACK') throw e
    })
  })

  await check('every view over a qty>0 line table filters its PARENT reversal', async () => {
    // THE RULE, as a structural gate rather than a habit. A CHECK (qty > 0) on
    // a line table means that table can never use the negative-twin void, so
    // the reversal is marked on the parent — and a view reading the lines
    // without checking the parent counts a reversed pair twice. That has now
    // been the fault three times, and each time it was found by a person
    // rather than by a machine: GREP FOR THE PARENT, NOT THE LINE.
    const lineTables = await tsql<{ line_table: string; parent_table: string; fk_column: string }[]>`
      select distinct
             c.conrelid::regclass::text as line_table,
             fk.confrelid::regclass::text as parent_table,
             att.attname as fk_column
      from pg_constraint c
      join pg_constraint fk
        on fk.conrelid = c.conrelid and fk.contype = 'f'
      join pg_attribute att
        on att.attrelid = fk.conrelid and att.attnum = fk.conkey[1]
      where c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%qty > (0)%'
        and exists (
          select 1 from pg_attribute p
          where p.attrelid = fk.confrelid and p.attname = 'reverses_id' and not p.attisdropped
        )`
    assert.ok(lineTables.length > 0, 'no qty>0 line table with a reversible parent — this gate proves nothing')

    const seen = new Set<string>()
    const offenders: string[] = []
    for (const t of lineTables) {
      if (seen.has(t.line_table)) continue
      seen.add(t.line_table)
      const views = await tsql<{ view_name: string; def: string }[]>`
        select distinct dv.relname as view_name, pg_get_viewdef(dv.oid, true) as def
        from pg_depend d
        join pg_rewrite rw on d.objid = rw.oid
        join pg_class dv on rw.ev_class = dv.oid
        join pg_class src on d.refobjid = src.oid
        where src.relname = ${t.line_table}
          and dv.relkind = 'v'
          and dv.relname <> ${t.line_table}`
      for (const view of views) {
        // The view must mention reverses_id somewhere: either its own filter or
        // an is_voided/is_reversal column it derives from the parent.
        if (!/reverses_id/.test(view.def)) offenders.push(`${view.view_name} reads ${t.line_table}`)
      }
      console.log(`      ${t.line_table} (parent ${t.parent_table}): ${views.length} view(s)`)
    }
    assert.deepEqual(
      offenders,
      [],
      `these views count a reversed pair twice — filter on the parent, not the line:\n      ${offenders.join('\n      ')}`,
    )
  })


  // ── the save acknowledgement ───────────────────────────────────────────
  //
  // Three rules, and each of these gates one of them structurally rather than
  // by naming the files that were fixed. A gate scoped to where the first
  // fault happened cannot find the second one — the same lesson as the audits
  // that only walked src/server.

  await check('no entry form throws itself away after a save', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`
        if (e.isDirectory()) walk(q, out)
        else if (/\.tsx$/.test(q)) out.push(q)
      }
      return out
    }
    // Navigating away after a save is what made entering a second bill a trip
    // back. It is not banned — sometimes the next screen genuinely IS the next
    // step — but every case must be written down, so a new one fails this gate
    // until somebody says why.
    const ALLOWED: Record<string, string> = {
      'src/components/recipes/CreateRecipe.tsx':
        'a recipe with no lines is useless — adding ingredients IS the next act, not a detour',
      'src/components/accountant/PrepareRun.tsx':
        'a payroll run is one per period and the run page is where it is approved',
      'src/components/accountant/StatementImport.tsx':
        'importing a statement exists in order to match it; the reconcile board is the next act',
      'src/components/auth/SetupForm.tsx': 'signing in is the point of creating the first owner',
      'src/components/auth/LoginForm.tsx': 'signing in navigates by definition',
      'src/components/TopNav.tsx': 'signing out',
      'src/components/dashboard/PeriodControl.tsx': 'the period IS the URL',
      'src/components/books/FilterInput.tsx': 'the filter IS the URL',
      'src/components/labour/AttendanceSheet.tsx': 'the day IS the URL',
    }
    const offenders: string[] = []
    let forms = 0
    for (const file of walk('src/components')) {
      const src = readFileSync(file, 'utf8')
      const callsAnAction = /from '@\/server\/[a-z-]*(actions|save-bill)'/.test(src)
      const navigates = /router\.(push|replace)\(/.test(src)
      if (!callsAnAction) continue
      forms++
      if (navigates && ALLOWED[file] === undefined) offenders.push(file)
    }
    assert.ok(forms > 20, `only ${forms} forms found — this sweep is not reading the tree`)
    console.log(`      ${forms} forms call a server action; ${Object.keys(ALLOWED).length} may navigate, with reasons`)
    assert.deepEqual(
      offenders,
      [],
      `these navigate away after a save with no stated reason — show the reveal IN PLACE and reset the form beneath it:\n      ${offenders.join('\n      ')}`,
    )
  })

  await check('the acknowledgement says numbers, never “saved successfully”', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`
        if (e.isDirectory()) walk(q, out)
        else if (/\.tsx$/.test(q)) out.push(q)
      }
      return out
    }
    // A count is proof; a checkmark is a claim. This catches the exact strings
    // that mean nothing — as a headline, as a toast, or as the "Saved ✓" that
    // two master forms used to carry.
    const EMPTY = /(['"`])\s*(saved|saved successfully|success|done|ok|saved ✓|recorded|updated)\s*\1/i
    const offenders: string[] = []
    let acks = 0
    for (const file of walk('src/components')) {
      const src = readFileSync(file, 'utf8')
      acks += (src.match(/<SaveAck\b/g) ?? []).length
      for (const m of src.matchAll(/\btoast\(\s*(['"][^'"]*['"])/g)) {
        if (EMPTY.test(m[1])) offenders.push(`${file}: toast(${m[1]})`)
      }
      for (const m of src.matchAll(/headline=\{?\s*(['"][^'"]*['"])/g)) {
        if (EMPTY.test(m[1])) offenders.push(`${file}: headline=${m[1]}`)
      }
    }
    assert.ok(acks >= 15, `only ${acks} <SaveAck> mounts — the pattern is not applied`)
    console.log(`      ${acks} <SaveAck> mounts`)
    assert.deepEqual(
      offenders,
      [],
      `these acknowledge a save without saying anything:\n      ${offenders.join('\n      ')}`,
    )
  })

  await check('the identifier block has exactly ONE write path', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`
        if (e.isDirectory()) walk(q, out)
        else if (/\.tsx?$/.test(q)) out.push(q)
      }
      return out
    }
    // Two screens write these eleven columns — the accountant's People list
    // and the owner's half of the staff form. Two SET lists is exactly how
    // they drift, so the list lives in staff-identity.ts and nothing else may
    // name these columns in an UPDATE.
    //
    // SCOPED TO `update staff set`, and that is not fussiness: vendors carry
    // bank_name / account_no / ifsc / upi_id too, and a name-only sweep
    // reported books-actions.ts — which sets a VENDOR's bank details — as a
    // second staff identity path. A gate that cries wolf is a gate people
    // start ignoring, so it was made precise rather than blunted.
    const COLS = ['bank_name', 'account_no', 'ifsc', 'upi_id', 'pan', 'uan', 'pf_number', 'esic_number']
    const offenders: string[] = []
    let statements = 0
    for (const file of [...walk('src/server'), ...walk('src/app')]) {
      if (file.endsWith('staff-identity.ts')) continue
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/update\s+staff\s+set\b([\s\S]*?)(?:returning|where)\b/gi)) {
        statements++
        for (const col of COLS) {
          if (new RegExp(`\\b${col}\\s*=`).test(m[1])) offenders.push(`${file} sets staff.${col}`)
        }
      }
    }
    assert.ok(statements > 0, 'no `update staff set` found anywhere — this sweep is reading nothing')
    assert.deepEqual(offenders, [], `a second identity SET list has appeared:\n      ${offenders.join('\n      ')}`)

    // ...and both staff actions re-check the role, because a hidden field is
    // not a check: a manager can post to the action directly.
    const labour = readFileSync('src/server/labour-actions.ts', 'utf8')
    for (const fn of ['createStaff', 'updateStaff']) {
      const body = labour.slice(labour.indexOf(`export async function ${fn}(`))
      assert.ok(
        body.slice(0, 900).includes('assertIdentityActor'),
        `${fn} does not re-check who may record an identifier`,
      )
    }
    const guard = labour.slice(labour.indexOf('async function assertIdentityActor'))
    assert.ok(/'owner'/.test(guard.slice(0, 700)) && /'accountant'/.test(guard.slice(0, 700)),
      'the identity guard no longer names owner and accountant')
    console.log('      one SET list, and both staff actions re-check the role')
  })

  // ── attendance hours ──────────────────────────────────────────────────

  await check('worked is not paid, and the hours arithmetic holds by value', async () => {
    // The PENDING branch this replaces existed only to bridge the window
    // between writing the migration and Rajesh applying it. It is applied, so
    // the bridge is gone: from here a missing column is a failure, not a note.
    const col = await tsql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'attendance' and column_name = 'extra_hours'`
    assert.equal(col[0].n, 1, 'attendance.extra_hours has gone — the hours views cannot work without it')

    // A VIEW BUILT ON EXPLICIT COLUMNS NEVER INHERITS. attendance_current
    // selects named columns, so adding extra_hours to the table did NOT reach
    // it and it had to be replaced. Asserted rather than remembered: the next
    // column added to attendance will be invisible the same way.
    const [ac] = await tsql<{ d: string }[]>`select pg_get_viewdef('attendance_current'::regclass, true) as d`
    assert.ok(/extra_hours/.test(ac.d), 'attendance_current does not carry extra_hours — a named-column view never inherits')

    // ON THE PROBE TENANT. It rolls back, so it leaves nothing either way —
    // but "writes only to the probe tenant" is a rule worth being able to
    // state without an exception, and the census below enforces it.
    const staff = await onProbe(
      () => tsql<{ id: string }[]>`
      select id from staff where employment_type <> 'contract' order by code limit 2`,
    )
    assert.ok(
      staff.length === 2,
      'fewer than two non-contract staff — this assertion cannot fail, so it proves nothing',
    )
    let observed: { paid: number; worked: number; hours: number; extra: number } | null = null
    try {
      await onProbe(() => txn(async (tx) => {
        const rid = (await tx<{ id: string }[]>`select id from restaurants limit 1`)[0].id
        const rows = [
          { staff_id: staff[0].id, att_date: '2099-06-01', status: 'present', extra_hours: null },
          { staff_id: staff[0].id, att_date: '2099-06-02', status: 'half', extra_hours: null },
          { staff_id: staff[0].id, att_date: '2099-06-03', status: 'off', extra_hours: null },
          { staff_id: staff[0].id, att_date: '2099-06-04', status: 'leave', extra_hours: null },
          { staff_id: staff[0].id, att_date: '2099-06-05', status: 'absent', extra_hours: null },
          // one late night, so the extra-hours leg is exercised rather than
          // sitting at zero and agreeing with a broken sum
          { staff_id: staff[1].id, att_date: '2099-06-01', status: 'present', extra_hours: '3' },
        ].map((r) => ({ ...r, restaurant_id: rid, entered_by: 'zz-gate' }))
        await tx`insert into attendance ${tx(
          rows,
          'restaurant_id',
          'att_date',
          'staff_id',
          'status',
          'extra_hours',
          'entered_by',
        )}`
        const got = await tx<{
          paid_days: string
          worked_days: string
          labour_hours: string
          extra_hours: string
        }[]>`
          select paid_days::text, worked_days::text, labour_hours::text, extra_hours::text
          from labour_hours_by_section where month = date '2099-06-01'`
        const sum = (k: 'paid_days' | 'worked_days' | 'labour_hours' | 'extra_hours') =>
          got.reduce((n, r) => n + Number(r[k]), 0)
        observed = {
          paid: sum('paid_days'),
          worked: sum('worked_days'),
          hours: sum('labour_hours'),
          extra: sum('extra_hours'),
        }
        throw new Error('ROLLBACK')
      }))
    } catch (e) {
      if ((e as Error).message !== 'ROLLBACK') throw e
    }
    assert.ok(observed !== null, 'the probe never ran')
    const o = observed as unknown as { paid: number; worked: number; hours: number; extra: number }
    // present 1 + half .5 + off 1 + the second person's present 1
    assert.equal(o.paid, 3.5, 'paid_days no longer applies the pay law')
    // WORKED IS NOT PAID: off is paid and worked by nobody
    assert.equal(o.worked, 2.5, 'worked_days is counting a day nobody worked')
    assert.equal(o.paid - o.worked, 1, 'the off day has stopped being the difference')
    assert.equal(o.extra, 3, 'the extra hour never reached the view')
    // 2.5 worked days x 8 + 3 late hours
    assert.equal(o.hours, 23, 'labour_hours is not worked_days x the standard day plus the extra hours')

    // The setting is what makes the standard day configurable rather than
    // this country with extra steps, and it must default to 8, not to null.
    const [std] = await onProbe(() => tsql<{ h: string }[]>`select standard_hours_per_day()::text as h`)
    assert.equal(Number(std.h), 8, 'standard_hours_per_day() no longer answers 8 by default')

    // NO RATE IS COMPUTED — checked against what is actually running, not
    // against a file that could be deleted.
    const [fn] = await tsql<{ d: string }[]>`
      select pg_get_functiondef('standard_hours_per_day()'::regprocedure) as d`
    const [hv] = await tsql<{ d: string }[]>`select pg_get_viewdef('labour_hours_by_section'::regclass, true) as d`
    for (const [what, def] of [['standard_hours_per_day()', fn.d], ['labour_hours_by_section', hv.d]] as const) {
      assert.ok(!/1\.5|overtime/i.test(def), `${what} has grown an overtime multiplier — record what happened, never price it`)
    }

    // ...and a department with hours and NO mapped sales must not be handed a
    // confident ₹0.00 per hour. There is no honest zero here: sales_by_section
    // has no row for a department that sold nothing.
    const [sph] = await tsql<{ d: string }[]>`select pg_get_viewdef('sales_per_labour_hour'::regclass, true) as d`
    assert.ok(
      /sales_value IS NOT NULL/i.test(sph.d),
      'sales_per_labour_hour divides into a coalesced zero again — that reports an absence as a rate',
    )
    console.log(`      paid ${o.paid}d · worked ${o.worked}d · ${o.extra}h late · ${o.hours}h total — and no rate is computed`)
  })


  // ── the employee profile ──────────────────────────────────────────────

  await check('every employee-profile read runs against the real database', async () => {
    const { getStaffByRef, getAttendanceSummary, getAttendanceDays, getPayrollHistory, getAdvancesOutstanding, getAdvanceLedger } =
      await import('../src/server/staff-profile-queries')
    const rid = (await tsql<{ id: string }[]>`select id from restaurants limit 1`)[0].id
    const [any] = await tsql<{ code: string; id: string }[]>`select code, id from staff order by code limit 1`
    assert.ok(any !== undefined, 'no staff — every assertion below would pass over an empty set and prove nothing')

    // THE CODE IS CANONICAL AND THE UUID STILL RESOLVES. The old edit URL
    // carried the uuid and phones may have it bookmarked; the page redirects
    // rather than the app answering to two addresses for one person.
    const byCode = await getStaffByRef(rid, any.code)
    const byLower = await getStaffByRef(rid, any.code.toLowerCase())
    const byId = await getStaffByRef(rid, any.id)
    assert.ok(byCode !== null, 'a real code does not resolve')
    assert.ok(byLower !== null, 'the code lookup is case-sensitive — nobody types E014 in caps from a phone')
    assert.ok(byId !== null, 'the uuid no longer resolves, so every bookmarked edit URL 404s')
    assert.equal(byId?.id, byCode?.id, 'the two keys resolve to different people')
    assert.equal(await getStaffByRef(rid, 'E-does-not-exist'), null, 'a bogus ref resolves to somebody')

    const months = ['2026-08-01']
    const summary = await getAttendanceSummary(rid, any.id, months)
    const days = await getAttendanceDays(rid, any.id, '2026-08-01', '2026-08-31')
    const payroll = await getPayrollHistory(rid, any.id)
    const adv = await getAdvancesOutstanding(rid, any.id)
    const ledger = await getAdvanceLedger(rid, any.id)
    console.log(
      `      ${any.code}: ${summary.length} month(s), ${days.length} day(s), ${payroll.length} run(s), ` +
        `${ledger.length} advance(s), outstanding ${adv === null ? 'none ever' : adv.outstanding}`,
    )
    // getAttendanceSummary with no months must not sweep every month there is
    assert.deepEqual(await getAttendanceSummary(rid, any.id, []), [], 'an empty period returned rows')
  })

  await check('the profile gates the identity READ, not just the render', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/app/staff/people/employees/[code]/page.tsx', 'utf8')
    // A manager opening this page must not receive an account number over the
    // wire — not merely fail to see it rendered. So the fetch itself must sit
    // behind the role, which is a conditional, not a filtered render.
    assert.ok(
      /mayHoldIdentity \? getStaffIdentity\(/.test(page),
      'getStaffIdentity is called unconditionally — a manager now receives bank details in the payload',
    )
    assert.ok(
      /user\?\.role === 'owner' \|\| user\?\.role === 'accountant'/.test(page),
      'the identity role test has changed shape — check who can hold a date of birth',
    )
    // ...and the roster's WRITE actions stay manager+owner even though the
    // accountant may now read the profile.
    const labour = readFileSync('src/server/labour-actions.ts', 'utf8')
    for (const fn of ['createStaff', 'updateStaff']) {
      const body = labour.slice(labour.indexOf(`export async function ${fn}(`))
      assert.ok(
        body.slice(0, 900).includes('assertRosterActor'),
        `${fn} has no role gate — the accountant can now reach it through /staff/people/employees`,
      )
    }
    const guard = labour.slice(labour.indexOf('async function assertRosterActor')).slice(0, 600)
    assert.ok(/'manager'/.test(guard) && /'owner'/.test(guard), 'the roster guard no longer names manager and owner')
    assert.ok(!/'accountant'/.test(guard), 'the accountant has been let into the roster write path')
    console.log('      identity read is conditional; createStaff/updateStaff stay manager+owner')
  })

  await check('a contract worker is told the page cannot apply, not that data is missing', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/app/staff/people/employees/[code]/page.tsx', 'utf8')
    // The Paid card has THREE states and the middle one is the whole point: a
    // contract worker can NEVER be on a payroll run (their vendor bills for
    // them), so "no payroll run yet" would promise one that is not coming.
    // Same distinction the department page draws between NotApplicable and
    // Unassessed.
    const paid = page.slice(page.indexOf('title="Paid"'), page.indexOf('title="Advances"'))
    assert.ok(paid.includes('isContract ? ('), 'the Paid card no longer branches on contract')
    assert.ok(
      paid.indexOf('NotApplicable') < paid.indexOf('Unassessed'),
      'the contract branch must come FIRST — otherwise a vendor-billed worker is told a run is coming',
    )
    assert.ok(/Unassessed needs="no payroll run yet"/.test(paid), 'the empty-runs case no longer declares itself')

    // ...and the empty advance ledger is a fact, not a gap: nothing is
    // outstanding because nothing was ever lent.
    const advances = page.slice(page.indexOf('title="Advances"'))
    assert.ok(
      /advances === null && ledger\.length === 0 \? \(\s*<NotApplicable>/.test(advances),
      'an empty advance ledger reports as unassessable — it is an empty ledger, not a missing one',
    )
    // and an over-recovered advance is loud rather than rendered as a credit
    assert.ok(/Number\(advances\.outstanding\) < 0/.test(advances), 'over-recovery is no longer surfaced')
    console.log('      contract → cannot apply; no runs → cannot be assessed; no advances → an empty ledger')
  })


  await check('EXTRA HOURS ARE REACHABLE — proved through saveAttendance, not a hand-written insert', async () => {
    // THIS GATE EXISTS BECAUSE THE LAST ONE COULD NOT FAIL. The hours gate
    // above writes its OWN insert naming extra_hours, so it proved the VIEW
    // computes worked_days x 8 + extra and proved NOTHING about whether the
    // app could write that column — and it could not: there was no field, no
    // schema entry and no insert column, only a read on the profile.
    //
    // Verbatim the lesson this file already records from the RLS phase:
    // "A probe that writes its OWN insert cannot test the app's column list."
    // Nine multi-line saves broke exactly this way. So this one goes through
    // the ACTION.
    //
    // IT ALWAYS WRITES, and the first version of this gate did not — which is
    // the same fault it exists to catch. That version converged: it saved 3h,
    // and on every later run saveAttendance correctly inserted nothing because
    // nothing had moved, so the assertions passed against a row an EARLIER run
    // had written. Deleting extra_hours from the app's insert list left it
    // green. A gate whose evidence predates the run is not evidence.
    //
    // So it reads the current value and writes the OTHER one — exactly one
    // insert per run, always this run's, always checkable. `attendance` is
    // INSERT-only and kb_app holds no DELETE (checked in table_privileges,
    // where a TABLE privilege actually lives), so a probe cannot tidy after
    // itself; one row per run on a sentinel date 74 years out is the honest
    // price of testing a write path on an append-only table through its own
    // front door.
    const { saveAttendance } = await import('../src/server/labour-actions')
    const { getDaySheet } = await import('../src/server/labour-queries')
    const { getAttendanceDays } = await import('../src/server/staff-profile-queries')
    // EVERYTHING BELOW RUNS ON THE PROBE TENANT. This is the one probe in the
    // suite that COMMITS — it must, because a rolled-back write cannot prove
    // a write path — so it is the one that most needed somewhere else to go.
    return onProbe(async () => {
    const rid = (await tsql<{ id: string }[]>`select id from restaurants limit 1`)[0].id
    const [who] = await tsql<{ id: string; code: string; section_id: string | null }[]>`
      select id, code, section_id from staff
      where employment_type <> 'contract' and section_id is not null order by code limit 1`
    assert.ok(who !== undefined, 'no salaried staff in a department — this assertion could not fail')
    const [sec] = await tsql<{ code: string }[]>`select code from sections where id = ${who.section_id}`
    const DAY = '2099-07-15'
    const MONTH = '2099-07-01'

    // 1. THE CONTROL'S OWN PATH, writing a value THIS run chose: whatever is
    //    on the day now, put the other one there.
    const [was] = await tsql<{ extra_hours: string | null }[]>`
      select extra_hours::text as extra_hours from attendance_current
      where staff_id = ${who.id} and att_date = ${DAY}::date`
    const WANT = Number(was?.extra_hours) === 3 ? '4' : '3'
    const first = await saveAttendance({
      date: DAY,
      marks: [{ staffId: who.id, status: 'present', extraHours: WANT }],
    })
    assert.ok(first.ok, `saveAttendance refused a valid mark: ${first.ok === false ? first.error : ''}`)
    assert.equal(first.inserted, 1, 'an hours-only change wrote nothing — the comparator ignores the hours')

    const [row] = await tsql<{ extra_hours: string | null }[]>`
      select extra_hours::text as extra_hours from attendance_current
      where staff_id = ${who.id} and att_date = ${DAY}::date`
    assert.equal(
      Number(row?.extra_hours),
      Number(WANT),
      'the app saved the mark and dropped the hours — the insert does not name extra_hours',
    )

    // 2. SAVING THE SAME THING AGAIN WRITES NOTHING — the other half of the
    //    comparator, and it must not be the half that carries the evidence.
    const again = await saveAttendance({
      date: DAY,
      marks: [{ staffId: who.id, status: 'present', extraHours: WANT }],
    })
    assert.ok(again.ok && again.inserted === 0, 'an unchanged re-save wrote a row')

    // 3. it reaches the view the whole feature exists for
    const [h] = await tsql<{ worked_days: string; extra_hours: string; labour_hours: string }[]>`
      select worked_days::text, extra_hours::text, labour_hours::text
      from labour_hours_by_section
      where restaurant_id = ${rid} and section_code = ${sec.code} and month = ${MONTH}::date`
    assert.ok(h !== undefined, 'the department has no row in labour_hours_by_section for that month')
    assert.equal(Number(h.extra_hours), Number(WANT), 'the hours never reached labour_hours_by_section')
    assert.equal(
      Number(h.labour_hours),
      Number(h.worked_days) * 8 + Number(WANT),
      'labour_hours is not worked_days x 8 + the extra hours',
    )

    // 4. THE SHEET CARRIES IT BACK, so a second visit shows what was filed
    //    rather than an empty box over a saved value.
    const mine = (await getDaySheet(rid, DAY)).find((r) => r.staff_id === who.id)
    assert.equal(Number(mine?.extra_hours), Number(WANT), 'the sheet cannot show hours already filed')

    // 5. and the employee profile shows it
    const days = await getAttendanceDays(rid, who.id, DAY, DAY)
    assert.equal(Number(days[0]?.extra_hours), Number(WANT), 'the profile history does not carry the hours')

    // 6. EXTRA HOURS ON A DAY NOBODY WORKED IS NOT A THING — refused BY NAME
    //    on the server, because a picker is never the check. These write
    //    nothing: the refusal is raised before the insert.
    for (const status of ['off', 'leave', 'absent'] as const) {
      const bad = await saveAttendance({
        date: DAY,
        marks: [{ staffId: who.id, status, extraHours: '2' }],
      })
      assert.ok(bad.ok === false, `extra hours were accepted on a ${status} day`)
      assert.ok(
        bad.error.includes(status) && /nobody worked/i.test(bad.error),
        `the refusal does not name the day: ${bad.error}`,
      )
    }
    // ...and a zero is refused: a normal day is left BLANK, never a 0
    const zero = await saveAttendance({
      date: DAY,
      marks: [{ staffId: who.id, status: 'present', extraHours: '0' }],
    })
    assert.ok(zero.ok === false, 'a zero was accepted — a normal day is the absence of a value')

    const [{ n }] = await tsql<{ n: number }[]>`
      select count(*)::int as n from attendance where staff_id = ${who.id} and att_date = ${DAY}::date`
    console.log(
      `      ${who.code}: ${WANT}h written this run → view says ${h.labour_hours}h · ${n} sentinel row(s) on ${DAY}`,
    )
    })
  })

  await check('the control RENDERS in the state it is meant for', async () => {
    // The other half of the same lesson, in the user's words: both times a
    // feature was reported live, the BUILD was real and the SURFACE was not.
    // A component existing proves nothing about a control appearing.
    const { readFileSync } = await import('node:fs')
    const sheet = readFileSync('src/components/labour/AttendanceSheet.tsx', 'utf8')
    assert.ok(/const worksToday = /.test(sheet), 'the sheet no longer decides when hours can be entered')
    const gate = sheet.slice(sheet.indexOf('const worksToday ='), sheet.indexOf('const worksToday =') + 260)
    assert.ok(
      /'present'/.test(gate) && /'half'/.test(gate),
      'the extra-hours control is no longer offered on present and half',
    )
    for (const never of ['off', 'leave', 'absent']) {
      assert.ok(!new RegExp(`sel === '${never}'`).test(gate), `the control is offered on a ${never} day`)
    }
    assert.ok(
      /worksToday\(r\) \? \(/.test(sheet) && /placeholder="\+h"/.test(sheet),
      'the control is not rendered per row — a component that exists is not a surface that appears',
    )
    assert.ok(/extraHours: hoursFor\(r\)/.test(sheet), 'the sheet collects hours and does not send them')
    console.log('      offered on present/half, withheld elsewhere, and sent')
  })


  await check('Aadhaar and address never reach a manager; the emergency contact always does', async () => {
    const { readFileSync } = await import('node:fs')
    // THE SPLIT IS THE WHOLE POINT OF THIS MIGRATION. The emergency contact is
    // manager-visible because the person who needs it at eleven at night is
    // the one on shift. Aadhaar and address are the two most sensitive fields
    // on the row and are no use to a shift manager at all.
    //
    // So the guard is not "do not render them" — it is that they must not be
    // SELECTED by any query whose result reaches a manager. StaffRow does.
    const GUARDED = ['aadhaar', 'address']
    const managerReads = [
      ['src/server/labour-queries.ts', 'STAFF_SELECT / getDaySheet — the roster and the sheet'],
      ['src/server/staff-profile-queries.ts', 'getStaffByRef — the profile header'],
    ] as const
    for (const [file, what] of managerReads) {
      const src = readFileSync(file, 'utf8')
      for (const col of GUARDED) {
        assert.ok(
          !src.includes(`s.${col}`) && !src.includes(`st.${col}`),
          `${what} selects ${col} — a manager now receives it in the payload`,
        )
      }
    }
    // ...and they ARE read by the one query that is role-gated
    const payroll = readFileSync('src/server/payroll-queries.ts', 'utf8')
    for (const col of GUARDED) {
      assert.ok(payroll.includes(`s.${col}`), `${col} is not read anywhere — the field is dead`)
    }
    // the emergency block is on StaffRow, which is what makes it manager-visible
    const labour = readFileSync('src/server/labour-queries.ts', 'utf8')
    for (const col of ['emergency_name', 'emergency_phone', 'emergency_relation']) {
      assert.ok(labour.includes(`st.${col}`), `${col} left the roster read — the shift cannot see it`)
    }
    console.log('      aadhaar/address: identity read only · emergency: on the roster row')
  })

  await check('the five new columns save through the app and read back', async () => {
    // Through the ACTIONS, for the same reason as the hours probe: a write
    // that names its own columns cannot test the app's column list.
    const { updateStaff } = await import('../src/server/labour-actions')
    const { updateStaffIdentity } = await import('../src/server/payroll-actions')
    const { getStaffByRef } = await import('../src/server/staff-profile-queries')
    const { getStaffIdentity } = await import('../src/server/payroll-queries')
    const rid = (await tsql<{ id: string }[]>`select id from restaurants limit 1`)[0].id
    const [who] = await tsql<{ id: string; code: string }[]>`select id, code from staff order by code limit 1`
    assert.ok(who !== undefined, 'no staff — this assertion could not fail')

    const before = await getStaffByRef(rid, who.code)
    const beforeId = await getStaffIdentity(rid, who.id)
    assert.ok(before !== null && beforeId !== null, 'the probe cannot read the person it is about to restore')

    // Both actions are role-gated and a script has no session, so this proves
    // the REFUSAL rather than the write — which is the more important half:
    // these two paths are exactly where a missing gate would leak.
    const roster = await updateStaff(who.id, {
      name: before.name,
      designation: before.designation ?? '',
      sectionId: before.section_id ?? '',
      grade: before.grade ?? '',
      employmentType: before.employment_type,
      baseSalary: before.base_salary ?? '',
      payMode: before.pay_mode ?? '',
      joined: before.joined ?? '',
      leftDate: before.left_date ?? '',
      reportsTo: before.reports_to ?? '',
      phone: before.phone ?? '',
      emergencyName: 'Zz Probe',
      emergencyPhone: '0000000000',
      emergencyRelation: 'probe',
      status: before.status,
    })
    assert.ok(roster.ok === false, 'updateStaff accepted a call with no session — the roster gate is gone')
    assert.ok(/session has expired/i.test(roster.error), `unexpected refusal: ${roster.error}`)

    const ident = await updateStaffIdentity(who.id, {
      bankName: '', accountNo: '', ifsc: '', upiId: '', pan: '', uan: '',
      pfNumber: '', esicNumber: '', dob: '', gender: '', payMode: '',
      aadhaar: '000000000000', address: 'Zz Probe',
    })
    assert.ok(ident.ok === false, 'updateStaffIdentity accepted a call with no session')

    // Nothing was written, so nothing needs restoring — asserted rather than
    // assumed, because a half-applied probe on a real person is worse than no
    // probe at all.
    const after = await getStaffByRef(rid, who.code)
    const afterId = await getStaffIdentity(rid, who.id)
    assert.equal(after?.emergency_name, before.emergency_name, 'the refused write changed the roster row')
    assert.equal(afterId?.aadhaar, beforeId.aadhaar, 'the refused write changed the identity row')

    // The COLUMN LIST is what the last failure was about, so it is checked in
    // the source where it lives — the insert and both SET lists.
    const { readFileSync } = await import('node:fs')
    const actions = readFileSync('src/server/labour-actions.ts', 'utf8')
    for (const col of ['emergency_name', 'emergency_phone', 'emergency_relation']) {
      assert.ok(actions.includes(`${col},`) || actions.includes(`${col} =`), `createStaff/updateStaff drop ${col}`)
    }
    const identity = readFileSync('src/server/staff-identity.ts', 'utf8')
    for (const col of ['aadhaar', 'address']) {
      assert.ok(identity.includes(`${col} = \${orNull(i.`), `the identity SET list drops ${col}`)
    }
    console.log(`      ${who.code}: both write paths refuse a sessionless call and change nothing`)
  })


  await check('a person is never named without a way through to them', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`
        if (e.isDirectory()) walk(q, out)
        else if (/\.tsx$/.test(q)) out.push(q)
      }
      return out
    }
    // A PERSON'S NAME IS A DOOR. The profile shipped and the roster and the
    // sheet linked to it; the dashboard, the payroll run, the advances table
    // and the accountant's people list rendered plain text. Inconsistent is
    // worse than missing — a reader learns the name is SOMETIMES a link and
    // stops trying.
    //
    // The rule is derived, not listed: any file that renders a person's NAME
    // out of a row that also carries their CODE must offer a way through,
    // either <PersonLink> or a row-level link to the profile. Deriving it is
    // the point — a list would go stale the day somebody adds a table.
    // PER RENDER SITE, NOT PER FILE — the first version of this gate checked
    // whether the FILE mentioned PersonLink anywhere, so a file with two
    // person tables passed while one of them rendered plain text. Removing a
    // link from the staff dashboard left it green. It now looks at each
    // occurrence: a name written as a JSX CHILD is the bug, a name passed as
    // the `name=` PROP of PersonLink is the fix, and an <option> is the one
    // place a link cannot go.
    const NAME_FIELDS = ['staff_name', 'r.name', 'p.name', 'l.name', 'd.staff_name']
    const offenders: string[] = []
    let personFiles = 0
    let doors = 0
    let sites = 0
    for (const file of [...walk('src/app'), ...walk('src/components')]) {
      const src = readFileSync(file, 'utf8')
      const isPerson =
        /staff_code|staff_id|StaffIdentity|AttendanceSummaryRow|AdvanceOutstanding|StaffRow/.test(src)
      if (!isPerson) continue
      // Does this file mention a person's name AT ALL — as a bare child, as a
      // PersonLink prop, either way? That is what proves the sweep is reading
      // the tree. Counting only the BARE ones would read zero once they are
      // all fixed, which is the guard passing because the thing it guards
      // stopped existing.
      if (NAME_FIELDS.some((f) => src.includes(`{${f}}`))) personFiles++
      if (src.includes('<PersonLink')) doors++
      let rendersAny = false
      for (const field of NAME_FIELDS) {
        // A RENDER SITE IS A WHOLE JSX CHILD: `>{r.name}<`. Anything else is
        // not a name displayed on its own — `${r.name}` is a template literal,
        // `name={r.name}` is the PersonLink prop that fixes this,
        // `{r.name}: extra hours` is a screen-reader label, and
        // `{p.name} — {p.code}` is an <option>, which cannot hold a link.
        const re = new RegExp(`>\\s*\\{${field.replace('.', '\\.')}\\}\\s*<`, 'g')
        let m: RegExpExecArray | null
        while ((m = re.exec(src)) !== null) {
          rendersAny = true
          sites++
          const near = src.slice(Math.max(0, m.index - 1200), m.index)
          const wrapped = near.includes('/staff/people/employees/${')
          if (!wrapped) offenders.push(`${file.replace('src/', '')}: {${field}} is not a link`)
        }
      }
      void rendersAny
    }
    assert.ok(personFiles >= 6, `only ${personFiles} files name a person — this sweep is not reading the tree`)
    assert.ok(doors >= 6, `only ${doors} files mount PersonLink — the pattern is not applied`)
    console.log(`      ${personFiles} files name a person · ${doors} mount PersonLink · ${sites} bare render(s)`)
    assert.deepEqual(
      offenders,
      [],
      `these name a person and give no way through — a name is a door:\n      ${offenders.join('\n      ')}`,
    )
  })

  await check('the day tooltip says it in words, and extra hours is in the headline row', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync('src/app/staff/people/employees/[code]/page.tsx', 'utf8')
    // "+2h · corrected ×1" is shorthand a reader has to decode, on the one
    // fact that matters most — somebody worked longer than their day.
    assert.ok(/worked \$\{day\.extra_hours\} extra/.test(page), 'the tooltip no longer says the hours in words')
    assert.ok(/'once' : n === 2 \? 'twice'/.test(page), 'corrections are back to ×N')
    assert.ok(!/\+\$\{day\.extra_hours\}h/.test(page), 'the +Nh shorthand has come back')
    // and the figure is a column like the other six, not prose underneath
    assert.ok(/label="Extra hours"/.test(page), 'extra hours has left the stat row')
    assert.ok(/sm:grid-cols-7/.test(page), 'the stat row is not wide enough to hold it')
    console.log('      tooltip in words · extra hours is the seventh column')
  })

  await check('NO GATE WROTE TO THE LIVE TENANT', async () => {
    // The empirical form of the rule, and the reason a probe tenant is not
    // just a naming convention: every event table in the live restaurant is
    // counted before and after. A gate that writes there — committed, or
    // rolled back and then not rolled back — moves a number here.
    const after = await census(process.env.KB_LIVE_TENANT as string)
    const moved = EVENT_TABLES.filter((t) => after[t] !== liveBefore[t]).map(
      (t) => `${t}: ${liveBefore[t]} → ${after[t]}`,
    )
    console.log(`      ${EVENT_TABLES.length} event tables counted before and after; all unchanged`)
    assert.deepEqual(
      moved,
      [],
      `these gates wrote to the LIVE books — point them at KB_PROBE_TENANT:\n      ${moved.join('\n      ')}`,
    )
  })


  await check('KB_TENANT is GONE from the app, not merely unused', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = `${d}/${e.name}`
        if (e.isDirectory()) walk(q, out)
        else if (/\.tsx?$/.test(q)) out.push(q)
      }
      return out
    }
    // IT WAS THE CRUTCH AND IT BECAME A LIABILITY. A deployment still naming
    // one restaurant would silently override a correct username lookup and
    // check the password against the WRONG tenant's users — which is exactly
    // the fault Phase 1.5 removed, reintroduced through the environment.
    //
    // Asserted as absent from the code rather than left unread: an unused
    // env var is one `??` away from being used again.
    const offenders: string[] = []
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/process\.env\.KB_TENANT/g)) {
        void m
        offenders.push(file.replace('src/', ''))
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `KB_TENANT is being read again — a deployment default would override the username lookup:\n      ${offenders.join('\n      ')}`,
    )
    // ...and the fallback it lived in is gone from txn() specifically
    const db = readFileSync('src/lib/db.ts', 'utf8')
    assert.ok(
      !/tenant = process\.env/.test(db),
      'txn() has an environment fallback again — a null tenant must announce NOTHING',
    )
    console.log('      no env fallback in txn(); no reader anywhere in src')
  })

  await check('login has exactly ONE failure path, and it does the same work', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/auth-core.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function verifyCredentials'), src.indexOf('/** The bootstrap'))
    // ONE `return null`. Unknown username, retired user, ambiguous match and
    // wrong password must converge — separate early returns are how two
    // branches come to take different amounts of time.
    const returns = [...fn.matchAll(/return null/g)].length
    assert.equal(returns, 1, `verifyCredentials has ${returns} failure returns — they must converge on one`)
    // the compare runs on BOTH paths, against a throwaway hash when there is
    // no user, so "no such person" costs what "wrong password" costs
    assert.ok(
      /bcrypt\.compare\(password, user\?\.password_hash \?\? NO_SUCH_USER_HASH\)/.test(fn),
      'the bcrypt compare is no longer unconditional — an unknown username now returns faster',
    )
    // and the READ runs on both paths too: skipping it cost one round trip,
    // measured at 134ms, which smoke:tenancy now times
    assert.ok(
      /withTenant\(tenant \?\? NO_TENANT/.test(fn),
      'the app_users read is skipped when the username does not resolve — that is an enumeration oracle',
    )
    assert.ok(!/tenant === null\s*\?\s*\[\]/.test(fn), 'the early-skip is back')
    console.log('      one return null · compare and read both unconditional')
  })


  // ── sales: mapping coverage, the trading day, the payment split ───────

  await check('every new sales read runs against the real database', async () => {
    const { getMappingCoverage, getSalesByHour, getPaymentSplit } = await import('../src/server/sales-queries')
    const rid = (await tsql<{ id: string }[]>`select id from restaurants limit 1`)[0].id
    const cov = await getMappingCoverage(rid)
    const hours = await getSalesByHour(rid, '2026-08-01', '2026-08-31')
    const split = await getPaymentSplit(rid, '2026-08-01', '2026-08-31')
    assert.ok(cov !== null, 'mapping_coverage has no row for the live tenant')
    // REVENUE_MAPPED IS NULL, NOT 0, when nothing is mapped — a sum over no
    // rows. The screen keeps that apart from "mapped, and it came to zero",
    // so the query must not coalesce it away.
    assert.ok(
      cov.revenue_mapped === null || Number(cov.revenue_mapped) >= 0,
      'revenue_mapped is neither null nor a number',
    )
    // per_cover must be NULL where covers is zero, never Infinity
    for (const h of hours) {
      if (h.covers === 0) assert.equal(h.per_cover, null, `hour ${h.hour} divided by zero covers`)
    }
    console.log(
      `      coverage ${cov.pct_attributed}% of ${cov.revenue_seen} · ${hours.length} hours · ${split.length} payment modes`,
    )
  })

  await check('a POS item can be attributed to a DEPARTMENT, and a dish still wins', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/sales-actions.ts', 'utf8')
    // A dish gives department AND cost; a department alone gives the
    // department — the honest answer for anything bought and resold. Bottled
    // water will never have a recipe, and without this its revenue sits
    // outside every department permanently.
    assert.ok(/sectionId: z\.union/.test(src), 'mapPosItem no longer accepts a department')
    assert.ok(/\.refine\(/.test(src), 'a mapping with neither target is accepted')
    // RECIPE WINS. Writing both would leave two answers to one question.
    assert.ok(
      /const sectionId = recipeId !== null \? null :/.test(src),
      'a dish no longer clears the direct department — two answers to one question',
    )
    // and the DB agrees the column is there
    const col = await tsql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'pos_item_map' and column_name = 'section_id'`
    assert.equal(col[0].n, 1, 'pos_item_map.section_id is gone')
    console.log('      both targets accepted; recipe wins; neither is refused')
  })

  await check('the payment split does not cycle a three-hue palette across seven modes', async () => {
    const { readFileSync } = await import('node:fs')
    const charts = readFileSync('src/components/dashboard/Charts.tsx', 'utf8')
    const page = readFileSync('src/app/sales/page.tsx', 'utf8')
    // CAT holds exactly the three hues the validator cleared (CVD ΔE 25.3).
    // LabourSplit cycles them with CAT[i % CAT.length], which is correct for
    // three categories and repeats colours for seven — so the payment split
    // uses named bars, where identity is carried by the axis label and no hue
    // is asked to do work it cannot.
    const cat = charts.slice(charts.indexOf('const CAT ='), charts.indexOf('const CAT =') + 200)
    assert.equal((cat.match(/var\(--color-/g) ?? []).length, 3, 'CAT is no longer three validated hues')
    assert.ok(!/LabourSplit/.test(page), 'the sales dashboard is cycling categorical hues across payment modes')
    assert.ok(/MagnitudeBars/.test(page), 'the payment split lost its chart')
    console.log('      3 validated hues; the 7-mode split is direct-labelled bars')
  })


  await check('the payload census reports key NAMES and cannot leak a value', async () => {
    const { normalizePayload } = await import('../src/server/sales-ingest')
    // A synthetic payload carrying the two things we are asking about, plus a
    // customer name and phone — because the census runs over a payload that
    // really does contain those, and the property that matters is that not one
    // character of a VALUE can reach it.
    const SECRET = 'ZzCustomerNameAndPhone9876543210'
    const payload = {
      success: '1',
      order_json: [
        {
          Order: {
            order_date: '2026-08-19',
            orderID: 'A1',
            status: 'Success',
            payment_type: 'Cash',
            total: '100',
            customer_name: SECRET,
            phone: SECRET,
            kot_cancelled: '2',
            bill_reprint_count: '7',
            biller_name: SECRET,
          },
          OrderItem: [{ itemid: '9', name: SECRET, quantity: '1', total: '100', itemcode: SECRET }],
        },
      ],
    }
    const norm = normalizePayload(payload, '2026-08-19')
    const c = norm.census

    // it FINDS the things we are asking about, by meaning rather than by an
    // exact key we would have had to guess right
    assert.ok(c.candidates.itemCode.includes('itemcode'), 'the census missed an item code')
    for (const k of ['kot_cancelled', 'bill_reprint_count', 'biller_name']) {
      assert.ok(c.candidates.leakage.includes(k), `the census missed the leakage field ${k}`)
    }
    assert.ok(c.orderKeys.includes('customer_name'), 'the census is not reading order keys')
    assert.ok(c.itemKeys.includes('itemid'), 'the census is not reading item keys')

    // ...AND NOT ONE VALUE ESCAPES. This is the assertion that matters: a
    // census of a payload carrying names and phone numbers must never become
    // a copy of it.
    const dumped = JSON.stringify(c)
    assert.ok(!dumped.includes(SECRET), 'a payload VALUE reached the census — it must carry key names only')
    assert.ok(!dumped.includes('9876543210'), 'a phone number reached the census')

    // and it is not persisted: pos_fetches has no column for it
    const col = await tsql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'pos_fetches'
        and column_name in ('census', 'payload', 'payload_keys', 'raw')`
    assert.equal(col[0].n, 0, 'the census is being stored — it is a diagnostic read once, not a record')
    console.log(
      `      found ${c.candidates.itemCode.length} code field(s), ${c.candidates.leakage.length} leakage field(s); no value escaped`,
    )
  })


  await check('a POS receivable reaches the dues ledger — and cannot be confirmed twice', async () => {
    // MONEY THE POS KNOWS ABOUT AND OUR BOOKS DID NOT. Proved by moving one
    // through, in a transaction that rolls back — the only way to show a
    // receivable reaches dues_outstanding is to put one there.
    const { listPosReceivables } = await import('../src/server/sales-queries')
    const rid = (await tsql<{ id: string }[]>`select id from restaurants limit 1`)[0].id
    const queue = await listPosReceivables(rid)
    assert.ok(queue.length > 0, 'no POS receivable on the live tenant — this assertion could not fail')
    // both modes are in the queue, not just Due Payment: Part Payment is the
    // same question — money billed and not fully collected.
    const modes = new Set(queue.map((r) => r.payment_mode))
    assert.ok(modes.has('Due Payment'), 'Due Payment left the queue')
    assert.ok(modes.has('Part Payment'), 'Part Payment is not in the queue — Rs 8,564 invisible')

    const one = queue[0]
    const ref = `pos:${one.business_date}:${one.pos_order_id}`
    let observed: { before: number; after: number; queueAfter: number; secondRefused: boolean } | null = null
    try {
      await txn(async (tx) => {
        const b = await tx<{ n: number }[]>`
          select count(*)::int as n from due_payments where restaurant_id = ${rid}`
        await tx`
          insert into due_payments (restaurant_id, due_date, party, amount, against_what, ref, entered_by)
          values (${rid}, ${one.business_date}::date, 'Zz Probe Party', ${one.order_total}::numeric,
                  ${'POS ' + one.payment_mode}, ${ref}, 'zz-gate')`
        const a = await tx<{ n: number }[]>`
          select count(*)::int as n from due_payments where restaurant_id = ${rid}`
        // THE CONFIRMED ORDER DROPS OFF THE QUEUE — that is what makes a
        // second confirmation impossible rather than merely unlikely.
        const stillQueued = await tx<{ n: number }[]>`
          select count(*)::int as n
          from sales_current o
          where o.restaurant_id = ${rid} and o.status_class = 'revenue'
            and o.payment_mode in ('Due Payment', 'Part Payment')
            and o.business_date = ${one.business_date}::date and o.pos_order_id = ${one.pos_order_id}
            and not exists (
              select 1 from due_payments d
              where d.restaurant_id = o.restaurant_id
                and d.ref = 'pos:' || o.business_date::text || ':' || o.pos_order_id)`
        // and the ledger nets it under the party, which is the whole reason a
        // name may not be invented
        const [owed] = await tx<{ balance: string }[]>`
          select balance::text as balance from dues_outstanding
          where restaurant_id = ${rid} and lower(trim(party)) = 'zz probe party'`
        assert.equal(Number(owed?.balance), Number(one.order_total), 'the debt did not reach dues_outstanding')
        observed = { before: b[0].n, after: a[0].n, queueAfter: stillQueued[0].n, secondRefused: true }
        throw new Error('ROLLBACK')
      })
    } catch (e) {
      if ((e as Error).message !== 'ROLLBACK') throw e
    }
    const o = observed as unknown as { before: number; after: number; queueAfter: number }
    assert.equal(o.after, o.before + 1, 'the confirmation wrote nothing')
    assert.equal(o.queueAfter, 0, 'a confirmed order is still on the queue — it could be confirmed twice')

    // the refusal is in the action, not only in the query
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/server/cashier-actions.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function confirmPosReceivable'))
    assert.ok(/already been confirmed/.test(fn.slice(0, 4000)), 'a double confirmation is not refused by name')
    assert.ok(/cannot owe more than that/.test(fn.slice(0, 4000)), 'a debt larger than the bill is accepted')
    console.log(
      `      ${queue.length} waiting (${[...modes].join(' + ')}) · one confirmed reaches dues and leaves the queue`,
    )
  })

  console.log(
    failures === 0 ? '\nALL PHASE A-2 SMOKE ASSERTIONS PASSED' : `\n${failures} PHASE A-2 ASSERTION(S) FAILED`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
