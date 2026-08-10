// Read side of settings + managed lists. Tab strips resolve here: stored
// 'tabs.<group>' JSON merged over the hardcoded defaults, then filtered by
// the role matrix — LAW 1 applies to tab strips too, so a tab a role cannot
// open is never rendered for it.
import 'server-only'
import { sql } from '@/lib/db'
import { resolveTabs, type TabDef, type TabGroup } from '@/lib/tabs'
import { canAccess, type Role } from '@/lib/roles'
import type { ListKey, ListOptionRow } from '@/lib/lists'

export async function getSettingValue(restaurantId: string, key: string): Promise<string | null> {
  const rows = await sql<{ value: string | null }[]>`
    select value from settings where restaurant_id = ${restaurantId} and key = ${key}`
  return rows[0]?.value ?? null
}

/** The tab strip a role actually gets for a group: settings-ordered,
 * settings-labelled, matrix-filtered. */
export async function tabsFor(restaurantId: string, group: TabGroup, role: Role): Promise<TabDef[]> {
  const raw = await getSettingValue(restaurantId, `tabs.${group}`)
  return resolveTabs(group, raw).filter((t) => canAccess(role, t.href))
}

/** Active values of one managed list, in sort order — what pickers render. */
export async function getList(restaurantId: string, key: ListKey): Promise<string[]> {
  const rows = await sql<{ value: string }[]>`
    select value from list_options
    where restaurant_id = ${restaurantId} and list_key = ${key} and status = 'active'
    order by sort_order asc, value asc`
  return rows.map((r) => r.value)
}

/** Every row of every managed list (retired included) for the Lists screen. */
export async function getAllListOptions(restaurantId: string): Promise<ListOptionRow[]> {
  return sql<ListOptionRow[]>`
    select id, list_key, value, sort_order, status
    from list_options
    where restaurant_id = ${restaurantId}
    order by list_key asc, sort_order asc, value asc`
}

/** Distinct values already used in a column — the picker-from-history for
 * person fields (handed_to, buyers, payees, due parties). Add-new stays
 * possible; the picker just makes “Asheel” vs “Asheel Sir” a choice, not an
 * accident. Table/column names come from the fixed map below, never input. */
const HISTORY_SOURCES = {
  handed_to: { table: 'day_closes', column: 'handed_to', date: 'close_date' },
  voucher_paid_to: { table: 'cash_vouchers', column: 'paid_to', date: 'voucher_date' },
  income_buyer: { table: 'other_income', column: 'buyer', date: 'income_date' },
  income_received_by: { table: 'other_income', column: 'received_by', date: 'income_date' },
  due_party: { table: 'due_payments', column: 'party', date: 'due_date' },
  expense_payee: { table: 'expenses', column: 'payee', date: 'expense_date' },
  non_revenue_given_to: { table: 'non_revenue', column: 'given_to', date: 'nr_date' },
} as const

export type HistoryField = keyof typeof HISTORY_SOURCES

export async function getNameHistory(restaurantId: string, field: HistoryField): Promise<string[]> {
  const src = HISTORY_SOURCES[field]
  const rows = await sql<{ name: string }[]>`
    select ${sql.unsafe(src.column)} as name, max(${sql.unsafe(src.date)}) as last_used
    from ${sql.unsafe(src.table)}
    where restaurant_id = ${restaurantId} and ${sql.unsafe(src.column)} is not null
    group by 1 order by last_used desc, 1 asc limit 40`
  return rows.map((r) => r.name)
}
