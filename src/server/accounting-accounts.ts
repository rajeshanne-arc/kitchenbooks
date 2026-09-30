'use server'

import { z } from 'zod'
import { tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import type { AccountingAccount } from '@/lib/types'

const Schema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/, 'Use a short account code'),
  name: z.string().trim().min(1, 'Name the account').max(120),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
})

export async function listAccountingAccounts(restaurantId: string): Promise<AccountingAccount[]> {
  return tsql<AccountingAccount[]>`
    select id, code, name, account_type, status
    from accounting_accounts
    where restaurant_id = ${restaurantId}
    order by code`
}

export async function createAccountingAccount(raw: unknown): Promise<
  { ok: true; account: AccountingAccount } | { ok: false; error: string }
> {
  try {
    const input = Schema.parse(raw)
    const user = await getSessionUser()
    if (!user || !['owner', 'accountant'].includes(user.role)) throw new Error('Only an accountant or owner can configure accounts')
    const restaurant = await getRestaurant()
    const [row] = await tsql<AccountingAccount[]>`
      insert into accounting_accounts (restaurant_id, code, name, account_type)
      values (${restaurant.id}, ${input.code.toUpperCase()}, ${input.name}, ${input.type})
      returning id, code, name, account_type, status`
    if (!row) throw new Error('The account could not be saved')
    return { ok: true, account: row }
  } catch (e) {
    return { ok: false, error: e instanceof z.ZodError ? 'Enter a valid code, name, and account type' : e instanceof Error ? e.message : 'The account could not be saved' }
  }
}

export async function linkMoneyAccount(input: {
  moneyAccountId: string
  accountingAccountId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await getSessionUser()
    if (!user || !['owner', 'accountant'].includes(user.role)) throw new Error('Only an accountant or owner can configure accounts')
    const restaurant = await getRestaurant()
    const [account] = await tsql<{ id: string }[]>`
      select id from accounting_accounts
      where restaurant_id = ${restaurant.id} and id = ${input.accountingAccountId} and status = 'active'`
    if (!account) throw new Error('Choose an active ledger account from this restaurant')
    const [updated] = await tsql<{ id: string }[]>`
      update money_accounts set accounting_account_id = ${account.id}
      where restaurant_id = ${restaurant.id} and id = ${input.moneyAccountId}
      returning id`
    if (!updated) throw new Error('Money account not found')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The account link could not be saved' }
  }
}
