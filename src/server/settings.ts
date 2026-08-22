// Read side of settings + managed lists. Tab strips resolve here: stored
// 'tabs.<group>' JSON merged over the hardcoded defaults, then filtered by
// the role matrix — LAW 1 applies to tab strips too, so a tab a role cannot
// open is never rendered for it.
import 'server-only'
import { sql, tsql } from '@/lib/db'
import { resolveTabs, type TabDef, type TabGroup } from '@/lib/tabs'
import { canAccess, type Role } from '@/lib/roles'
import type { ListKey, ListOptionRow, ListSuggestionRow } from '@/lib/lists'

export async function getSettingValue(restaurantId: string, key: string): Promise<string | null> {
  const rows = await tsql<{ value: string | null }[]>`
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
  const rows = await tsql<{ value: string }[]>`
    select value from list_options
    where restaurant_id = ${restaurantId} and list_key = ${key} and status = 'active'
    order by sort_order asc, value asc`
  return rows.map((r) => r.value)
}

/** Every row of every managed list (retired included) for the Lists screen. */
export async function getAllListOptions(restaurantId: string): Promise<ListOptionRow[]> {
  return tsql<ListOptionRow[]>`
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

/**
 * FREQUENCY THEN RECENCY — the same rank as every other picker in the app.
 *
 * This was `last_used desc` alone, which is half the rule: one voucher paid to
 * somebody once, yesterday, outranked the payee who takes money every week. The
 * regular one is what the finger is reaching for, and the whole point of these
 * pickers is that "Asheel" and "Asheel Sir" stay one person — a name that is
 * hard to find gets retyped, and a retyped name is how the second spelling is
 * born.
 *
 * Recency still breaks the tie, so somebody new does not sink under a long tail
 * of one-offs.
 */
export async function getNameHistory(restaurantId: string, field: HistoryField): Promise<string[]> {
  const src = HISTORY_SOURCES[field]
  const rows = await tsql<{ name: string }[]>`
    select ${sql.unsafe(src.column)} as name,
           count(*) as times,
           max(${sql.unsafe(src.date)}) as last_used
    from ${sql.unsafe(src.table)}
    where restaurant_id = ${restaurantId} and ${sql.unsafe(src.column)} is not null
    group by 1 order by times desc, last_used desc, 1 asc limit 40`
  return rows.map((r) => r.name)
}

/** A list value the app will accept, INCLUDING one nobody has approved yet.
 *
 * LAW 2 said "lists, not free text", and it was right about the danger —
 * "Asheel" and "Asheel Sir" are two vendors to a computer. It was wrong
 * about the remedy: refusing the save stops the WORK, and the person with
 * the receipt in their hand cannot wait for an owner to log in. So a typed
 * value is accepted, recorded in list_suggestions as pending, and the owner
 * decides later whether it becomes vocabulary. Entry never blocks; the
 * decision is still deliberate.
 */
export async function isAcceptedListValue(
  restaurantId: string,
  key: ListKey,
  value: string,
): Promise<boolean> {
  const clean = value.trim()
  if (clean === '') return false
  const approved = await getList(restaurantId, key)
  if (approved.some((v) => v.toLowerCase() === clean.toLowerCase())) return true
  const pending = await tsql<{ id: string }[]>`
    select id from list_suggestions
    where restaurant_id = ${restaurantId} and list_key = ${key}
      and lower(value) = ${clean.toLowerCase()} and status = 'pending'`
  return pending.length > 0
}

/** Pending suggestions for the Settings screen, newest first. */
/** How many typed values are waiting on an owner's decision.
 *
 *  Painted on the Setup tab and on the Lists chip inside it. Setup is
 *  otherwise five screens of configuration nobody opens twice; this is the one
 *  thing in there that is a TASK, and the badge is what makes it visible from
 *  the strip. Silent at zero. */
export async function countPendingSuggestions(
  restaurantId: string,
  // OPTIONAL HANDLE, the getClosePrefill shape — so the gate can write a
  // suggestion, read the count through THIS function and roll back, rather
  // than asserting against a hand-written copy of the query.
  db: typeof tsql = tsql,
): Promise<number> {
  const rows = await db<{ n: number }[]>`
    select count(*)::int as n from list_suggestions
    where restaurant_id = ${restaurantId} and status = 'pending'`
  return rows[0]?.n ?? 0
}

export async function getListSuggestions(restaurantId: string): Promise<ListSuggestionRow[]> {
  return tsql<ListSuggestionRow[]>`
    select s.id, s.list_key, s.value, s.suggested_by, s.seen_count, s.status,
           s.created_at::text as created_at,
           k.kind as expense_kind
    from list_suggestions s
    left join expense_category_kinds k
      on k.restaurant_id = s.restaurant_id and k.category = s.value
    where s.restaurant_id = ${restaurantId} and s.status = 'pending'
    order by s.seen_count desc, s.created_at desc`
}

/** How each approved expense category is classified for the P&L. */
export async function getExpenseKinds(restaurantId: string): Promise<Record<string, string>> {
  const rows = await tsql<{ category: string; kind: string }[]>`
    select category, kind from expense_category_kinds where restaurant_id = ${restaurantId}`
  return Object.fromEntries(rows.map((r) => [r.category, r.kind]))
}
