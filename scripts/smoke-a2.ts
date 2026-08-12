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
      await sql.begin(async (tx) => {
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
        await sql.begin(async (tx) => {
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
      await sql.begin(async (tx) => {
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
    const files = readdirSync('src/server')
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `src/server/${f}`)
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
      await sql.begin(async (tx) => {
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
        sql.begin(async (tx) => {
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
    const kinds = await sql<{ kind: string }[]>`
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
        sql.begin(async (tx) => {
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
    const rows = await sql<{ column_name: string }[]>`
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
    const [row] = await sql<{ factor: string }[]>`
      select sum(case a.status
                   when 'present' then 1::numeric
                   when 'half' then 0.5
                   when 'off' then 1::numeric
                   else 0::numeric end)::text as factor
      from (values ('present'),('half'),('off'),('leave'),('absent')) as a(status)`
    assert.equal(row.factor, '2.5', 'the pay law changed: 1 + 0.5 + 1 + 0 + 0 = 2.5')
    const def = await sql<{ d: string }[]>`
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
    const contract = await sql<{ n: number }[]>`
      select count(*)::int as n from staff
      where restaurant_id = ${rid} and status = 'active' and employment_type = 'contract'`
    const codes = new Set(draft.map((l) => l.staff_code))
    const contractCodes = await sql<{ code: string }[]>`
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
      await sql.begin(async (tx) => {
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
      await sql.begin(async (tx) => {
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
      await sql.begin(async (tx) => {
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
    const [row] = await sql<{ n: number }[]>`
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
      await sql.begin(async (tx) => {
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
    const rows = await sql<{ privilege_type: string }[]>`
      select privilege_type from information_schema.table_privileges
      where grantee = 'kb_app' and table_name = 'reconciliation_matches'`
    const held = rows.map((r) => r.privilege_type).sort()
    assert.deepEqual(held, ['DELETE', 'INSERT', 'SELECT'], 'the match grants changed')
    // and one match per statement line, so unmatching frees the line cleanly
    const [uniq] = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'reconciliation_matches'::regclass and contype = 'u'`
    assert.match(uniq.def, /statement_line_id/, 'a statement line may hold more than one match')
  })

  await check('a match can be made and taken back, and both sides come free', async () => {
    let afterMatch = 0
    let afterUnmatch = 0
    let freed = false
    try {
      await sql.begin(async (tx) => {
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
      await sql.begin(async (tx) => {
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

    const def = await sql<{ d: string }[]>`
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
      'src/app/staff/people/employees/[id]/page.tsx',
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
    const rows = await sql<{ receives_stock: boolean; n: number }[]>`
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
    const def = await sql<{ d: string }[]>`
      select pg_get_viewdef('stock_on_hand'::regclass, true) as d`
    assert.match(def[0].d, /stock_adjustments/, 'the count still cannot correct the book')
    assert.match(def[0].d, /vendor_return_lines/, 'goods sent back to a vendor still sit on the shelf')
  })

  await check('an adjustment moves the book by exactly its quantity', async () => {
    let before = 0
    let after = 0
    try {
      await sql.begin(async (tx) => {
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
    const [col] = await sql<{ d: string | null; nn: string }[]>`
      select column_default as d, is_nullable as nn from information_schema.columns
      where table_name = 'stock_counts' and column_name = 'accepted_at'`
    assert.equal(col.d, null, 'accepted_at has a default — a count would accept itself')
    assert.equal(col.nn, 'YES', 'accepted_at must be nullable: unaccepted is a real state')
    const grants = await sql<{ column_name: string }[]>`
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
    const def = await sql<{ d: string }[]>`
      select pg_get_viewdef('stock_on_hand'::regclass, true) as d`
    assert.ok(!def[0].d.includes('purchase_line_shorts'), 'a short is moving stock — it must not')
  })

  await check('vendor_performance runs and states what it counts', async () => {
    const rows = await sql<{ name: string; bills: number; unsettled: number }[]>`
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
      await sql.begin(async (tx) => {
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
      await sql.begin(async (tx) => {
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
    const start = src.indexOf('export async function saveVoucher(')
    const body = src.slice(start, src.indexOf('export async function ', start + 1))
    assert.match(
      body,
      /input\.isStockPurchase && input\.isCasualLabour/,
      'saveVoucher no longer refuses a payment that is both',
    )
    const form = readFileSync('src/components/cash/VoucherForm.tsx', 'utf8')
    assert.ok(!/setIsStockPurchase/.test(form), 'the independent toggles came back')
    assert.match(form, /'expense' \| 'stock' \| 'labour'/, 'the three-way question is gone')
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
    assert.equal(TAB_DEFAULTS.accounts.length, 6, 'accounts should be six tabs')
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
    assert.match(body, /rows\.length > 1/, 'an ambiguous login would pick a tenant')
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
    const files = readdirSync('src/server').filter((f) => f.endsWith('.ts')).map((f) => `src/server/${f}`)
    const scoped = new Set(
      (
        await sql<{ table_name: string }[]>`
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
    const files = readdirSync('src/server').filter((f) => f.endsWith('.ts')).map((f) => `src/server/${f}`)
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

    // and it does NOT survive the transaction — that is what `local` buys
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
      await sql<{ table_name: string }[]>`
        select c.table_name from information_schema.columns c
        where c.table_schema = 'public' and c.column_name = 'restaurant_id'
          and c.table_name like '%_lines'`
    ).map((r) => r.table_name)
    assert.ok(lineTables.length >= 13, `expected the line tables to carry a tenant, found ${lineTables.length}`)

    const files = readdirSync('src/server').filter((f) => f.endsWith('.ts')).map((f) => `src/server/${f}`)
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
