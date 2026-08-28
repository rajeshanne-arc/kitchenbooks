// Money accounts: where the money actually sits.
//
// USER-NAMED AND TYPE-TAGGED. The kinds are cash / bank / wallet /
// card_settlement / owner / other — shapes, not brands. Nothing here knows
// what a bank is called in any particular country, which is what lets the
// same product be sold outside the one it was built in.
import 'server-only'
import { tsql } from '@/lib/db'
import type { AccountBalanceRow, MoneyAccount } from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function listMoneyAccounts(
  restaurantId: string,
  includeRetired = false,
  showClosed = false,
): Promise<MoneyAccount[]> {
  return tsql<MoneyAccount[]>`
    select id, name, kind, identifier, is_till,
           opening_balance::text as opening_balance,
           opening_date::text as opening_date,
           sort_order, status
    from money_accounts
    where restaurant_id = ${restaurantId}
      and (${includeRetired} or status = 'active')
      -- ARCHIVED, NOT DELETED. A merged or discarded row leaves the browsing
      -- list and stays findable — see src/lib/closed.ts. Retired is NOT one of
      -- these: a retired row may come back and stays visible, marked.
      and (${showClosed} or status not in ('merged', 'discarded'))
    order by sort_order asc, name asc`
}

export async function getMoneyAccount(restaurantId: string, id: string): Promise<MoneyAccount | null> {
  const rows = await tsql<MoneyAccount[]>`
    select id, name, kind, identifier, is_till,
           opening_balance::text as opening_balance,
           opening_date::text as opening_date,
           sort_order, status
    from money_accounts
    where restaurant_id = ${restaurantId} and id = ${id}`
  return rows[0] ?? null
}

/** Balance per account, straight from account_balances. */
export async function getAccountBalances(restaurantId: string): Promise<AccountBalanceRow[]> {
  return tsql<AccountBalanceRow[]>`
    select account_id, name, kind, identifier, is_till, basis,
           counted_on::text as counted_on,
           opening_balance::text as opening_balance,
           coalesce(movements, 0)::text as movements,
           coalesce(balance, 0)::text as balance,
           last_move::text as last_move
    from account_balances
    where restaurant_id = ${restaurantId}
    order by kind asc, name asc`
}

/** How many money movements name no account. books_completeness counts this
 *  too; the picker's own screens surface it where it can be fixed. */
export async function countUnaccountedMovements(restaurantId: string): Promise<number> {
  const [row] = await tsql<{ n: number }[]>`
    select count(*)::int as n from money_movements
    where restaurant_id = ${restaurantId} and account_id is null`
  return row?.n ?? 0
}


/** Thrown when a money form names no account. */
export class AccountRefusal extends Error {}

/** THE SHARED REFUSAL. account_id is nullable in the database on purpose —
 *  history predates accounts and must not be rewritten — but the app will
 *  not ADD a movement that names no account.
 *
 *  This is the lesson from issues.session and recipes.output_qty, both of
 *  which had a column default standing in for a human answer and lied
 *  quietly for months. There is no default account and there never will be:
 *  a blank is refused by name, at the moment it can still be fixed. */
export async function assertAccount(
  restaurantId: string,
  accountId: string,
  label = 'the account this money moved through',
): Promise<string> {
  if (!UUID.test(accountId)) {
    throw new AccountRefusal(`Name ${label} — it is not assumed, and the books cannot place the money without it`)
  }
  const accounts = await listMoneyAccounts(restaurantId)
  if (!accounts.some((a) => a.id === accountId)) {
    throw new AccountRefusal('That account is not on the active list')
  }
  return accountId
}
