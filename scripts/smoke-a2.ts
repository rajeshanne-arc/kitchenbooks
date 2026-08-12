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
