'use server'

import { tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { POSTING_KEYS } from '@/lib/accounting'

export type PostingMapping = {
  mapping_key: string
  account_id: string
  code: string
  name: string
  account_type: string
}

/** A missing mapping is a readiness failure, never permission to choose the
 * first account. */
export async function listPostingMappings(restaurantId: string): Promise<PostingMapping[]> {
  return tsql<PostingMapping[]>`
    select m.mapping_key, m.account_id, a.code, a.name, a.account_type
    from accounting_posting_mappings m
    join accounting_accounts a
      on a.restaurant_id = m.restaurant_id and a.id = m.account_id
    where m.restaurant_id = ${restaurantId} and a.status = 'active'
    order by m.mapping_key`
}

export async function getPostingAccount(restaurantId: string, mappingKey: string): Promise<string | null> {
  const [row] = await tsql<{ account_id: string }[]>`
    select m.account_id
    from accounting_posting_mappings m
    join accounting_accounts a on a.restaurant_id = m.restaurant_id and a.id = m.account_id
    where m.restaurant_id = ${restaurantId} and m.mapping_key = ${mappingKey} and a.status = 'active'`
  return row?.account_id ?? null
}

export async function savePostingMapping(input: {
  mappingKey: string
  accountId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!POSTING_KEYS.includes(input.mappingKey as (typeof POSTING_KEYS)[number])) {
      return { ok: false, error: 'That posting concept is not supported' }
    }
    const user = await getSessionUser()
    if (!user || !['owner', 'accountant'].includes(user.role)) {
      return { ok: false, error: 'Only an accountant or owner can configure mappings' }
    }
    const restaurant = await getRestaurant()
    const [account] = await tsql<{ id: string }[]>`
      select id from accounting_accounts
      where restaurant_id = ${restaurant.id} and id = ${input.accountId} and status = 'active'`
    if (!account) return { ok: false, error: 'Choose an active account from this restaurant' }
    await tsql`
      insert into accounting_posting_mappings (restaurant_id, mapping_key, account_id, updated_by)
      values (${restaurant.id}, ${input.mappingKey}, ${account.id}, ${user.username})
      on conflict (restaurant_id, mapping_key) do update
      set account_id = excluded.account_id, updated_by = excluded.updated_by, updated_at = now()`
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The mapping could not be saved' }
  }
}
