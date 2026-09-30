import 'server-only'

import type postgres from 'postgres'
import { sql as sqlFragment, tsql } from '@/lib/db'
import type { AccountingStatementRow, CashFlowRow, JournalIntegrity, TrialBalanceRow } from '@/lib/types'

export type JournalLineInput = {
  accountId: string
  description?: string
  debit?: string
  credit?: string
}

/**
 * The only application entry point for double-entry posting. The database
 * function checks tenant, balance, active accounts, and closed periods in the
 * same transaction as the insert. Operational records should call this from
 * their write transaction when that workflow is migrated to journal posting.
 */
export async function postJournalEntry(input: {
  date: string
  sourceType: string
  sourceId?: string
  memo: string
  postedBy?: string
  lines: JournalLineInput[]
}): Promise<string> {
  return postJournalEntryWith(tsql, {
    restaurantId: undefined,
    ...input,
  })
}

async function postJournalEntryWith(
  handle: typeof tsql,
  input: {
    restaurantId?: string
    date: string
    sourceType: string
    sourceId?: string
    memo: string
    postedBy?: string
    lines: JournalLineInput[]
  },
): Promise<string> {
  const tenantArg = input.restaurantId === undefined
    ? sqlFragment`current_setting('app.restaurant_id')::uuid`
    : sqlFragment`${input.restaurantId}::uuid`
  const [row] = await handle<{ id: string }[]>`
    select post_journal_entry(
      ${tenantArg},
      ${input.date}::date,
      ${input.sourceType},
      ${input.sourceId ?? null}::uuid,
      ${input.memo},
      ${input.postedBy ?? null},
      ${sqlFragment.json(input.lines.map((line) => ({
        account_id: line.accountId,
        description: line.description ?? null,
        debit: line.debit ?? '0',
        credit: line.credit ?? '0',
      })))}
    ) as id`
  if (!row?.id) throw new Error('The journal entry could not be verified')
  return row.id
}

/** Same boundary while a source row is being created. Keeping the function
 * call on the caller's transaction is what makes a payment and its journal
 * entry commit or roll back together. */
export async function postJournalEntryTx(
  tx: postgres.TransactionSql,
  restaurantId: string,
  input: Omit<Parameters<typeof postJournalEntry>[0], 'postedBy'> & { postedBy?: string },
): Promise<string> {
  return postJournalEntryWith(tx as unknown as typeof tsql, { ...input, restaurantId })
}

/** @scope all-time */
export async function getJournalIntegrity(restaurantId: string): Promise<JournalIntegrity> {
  const [row] = await tsql<JournalIntegrity[]>`
    with totals as (
      select journal_entry_id, sum(debit) as debits, sum(credit) as credits
      from journal_lines
      where restaurant_id = ${restaurantId}
      group by journal_entry_id
    ), orphan_lines as (
      select count(*)::int as n
      from journal_lines l
      left join journal_entries e
        on e.restaurant_id = l.restaurant_id and e.id = l.journal_entry_id
      where l.restaurant_id = ${restaurantId} and e.id is null
    )
    select count(*)::int as entries,
           count(*) filter (where round(coalesce(t.debits, 0), 2) <> round(coalesce(t.credits, 0), 2))::int
             as unbalanced_entries,
           (select n from orphan_lines) as lines_without_entry
    from journal_entries e
    left join totals t on t.journal_entry_id = e.id
    where e.restaurant_id = ${restaurantId}`
  return row ?? { entries: 0, unbalanced_entries: 0, lines_without_entry: 0 }
}

/** The accountant's control total. A trial balance is read from posted lines,
 * never recomputed from operational tables in the browser. */
export async function getTrialBalance(restaurantId: string): Promise<TrialBalanceRow[]> {
  return tsql<TrialBalanceRow[]>`
    select a.id as account_id, a.code, a.name, a.account_type,
           coalesce(sum(l.debit), 0)::text as debits,
           coalesce(sum(l.credit), 0)::text as credits,
           (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0))::text as balance
    from accounting_accounts a
    left join journal_lines l
      on l.restaurant_id = a.restaurant_id and l.account_id = a.id
    where a.restaurant_id = ${restaurantId}
    group by a.id, a.code, a.name, a.account_type
    order by a.account_type, a.code`
}

/** Posted journal basis for the income statement. Revenue is credit-normal;
 * expenses are debit-normal, so both are returned as positive presentation
 * amounts.
 * @scope period */
export async function getProfitAndLoss(
  restaurantId: string,
  from: string,
  to: string,
): Promise<AccountingStatementRow[]> {
  return tsql<AccountingStatementRow[]>`
    select a.id as account_id, a.code, a.name, a.account_type,
      case when a.account_type = 'revenue'
        then coalesce(sum(l.credit - l.debit), 0)
        else coalesce(sum(l.debit - l.credit), 0)
      end::text as amount
    from accounting_accounts a
    join journal_lines l on l.restaurant_id = a.restaurant_id and l.account_id = a.id
    join journal_entries e on e.restaurant_id = l.restaurant_id and e.id = l.journal_entry_id
    where a.restaurant_id = ${restaurantId}
      and a.account_type in ('revenue', 'expense')
      and e.entry_date between ${from}::date and ${to}::date
    group by a.id, a.code, a.name, a.account_type
    order by a.account_type, a.code`
}

/** Cumulative posted journal basis through the report end. This intentionally
 * excludes unposted operational records and makes the accounting boundary
 * visible to the user.
 * @scope period */
export async function getBalanceSheet(
  restaurantId: string,
  to: string,
): Promise<AccountingStatementRow[]> {
  return tsql<AccountingStatementRow[]>`
    select a.id as account_id, a.code, a.name, a.account_type,
      case when a.account_type in ('liability', 'equity')
        then coalesce(sum(l.credit - l.debit), 0)
        else coalesce(sum(l.debit - l.credit), 0)
      end::text as amount
    from accounting_accounts a
    join journal_lines l on l.restaurant_id = a.restaurant_id and l.account_id = a.id
    join journal_entries e on e.restaurant_id = l.restaurant_id and e.id = l.journal_entry_id
    where a.restaurant_id = ${restaurantId}
      and a.account_type in ('asset', 'liability', 'equity')
      and e.entry_date <= ${to}::date
    group by a.id, a.code, a.name, a.account_type
    order by a.account_type, a.code`
}

/** Direct cash movement from explicitly mapped drawers, banks and wallets.
 * The counterpart account is deliberately not inferred here; an unmapped
 * money account produces no cash-flow row and remains visible as a setup gap.
 * @scope period */
export async function getCashFlow(
  restaurantId: string,
  from: string,
  to: string,
): Promise<CashFlowRow[]> {
  return tsql<CashFlowRow[]>`
    select e.entry_date, e.source_type, e.memo, a.name as account_name,
      case when l.debit > 0 then 'inflow' else 'outflow' end as direction,
      case when l.debit > 0 then l.debit else l.credit end::text as amount
    from money_accounts m
    join accounting_accounts a
      on a.restaurant_id = m.restaurant_id and a.id = m.accounting_account_id
    join journal_lines l on l.restaurant_id = a.restaurant_id and l.account_id = a.id
    join journal_entries e on e.restaurant_id = l.restaurant_id and e.id = l.journal_entry_id
    where m.restaurant_id = ${restaurantId}
      and m.accounting_account_id is not null
      and e.entry_date between ${from}::date and ${to}::date
    order by e.entry_date, e.posted_at, e.id`
}

/** Indirect cash-flow bridge: period profit plus changes in non-cash working
 * capital. Mapped cash/bank/wallet accounts are excluded from the balance
 * changes, so this does not double-count the direct statement. */
/** @scope period */
export async function getIndirectCashFlow(restaurantId: string, from: string, to: string): Promise<CashFlowRow[]> {
  return tsql<CashFlowRow[]>`
    with profit as (
      select coalesce(sum(case when a.account_type = 'revenue' then l.credit - l.debit else l.debit - l.credit end), 0) as amount
      from accounting_accounts a join journal_lines l on l.restaurant_id = a.restaurant_id and l.account_id = a.id
      join journal_entries e on e.restaurant_id = l.restaurant_id and e.id = l.journal_entry_id
      where a.restaurant_id = ${restaurantId} and a.account_type in ('revenue', 'expense') and e.entry_date between ${from}::date and ${to}::date
    ), balances as (
      select a.id, a.name, a.account_type,
        coalesce(sum(case when e.entry_date < ${from}::date then case when a.account_type = 'liability' then l.credit - l.debit else l.debit - l.credit end else 0 end), 0) as opening,
        coalesce(sum(case when a.account_type = 'liability' then l.credit - l.debit else l.debit - l.credit end), 0) as closing
      from accounting_accounts a join journal_lines l on l.restaurant_id = a.restaurant_id and l.account_id = a.id
      join journal_entries e on e.restaurant_id = l.restaurant_id and e.id = l.journal_entry_id
      where a.restaurant_id = ${restaurantId} and a.account_type in ('asset', 'liability') and e.entry_date <= ${to}::date
        and not exists (select 1 from money_accounts m where m.restaurant_id = a.restaurant_id and m.accounting_account_id = a.id and m.status = 'active')
      group by a.id, a.name, a.account_type
    ), movements as (
      select ${to}::date as entry_date, 'indirect'::text as source_type, 'Net profit'::text as memo, 'Net profit'::text as account_name, amount from profit
      union all
      select ${to}::date, 'indirect', 'Working-capital change', name, case when account_type = 'asset' then opening - closing else closing - opening end from balances
    )
    select entry_date, source_type, memo, account_name,
           case when amount >= 0 then 'inflow' else 'outflow' end as direction,
           abs(amount)::text as amount
    from movements where amount <> 0
    order by entry_date, account_name`
}
