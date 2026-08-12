'use server'

// Write side of settings + managed lists.
//   Lists: add value, reorder, retire — NEVER delete (history keeps its
//   words). Values live in list_options under the seven seeded keys; the
//   grants are INSERT + UPDATE(value, sort_order, status), nothing else.
//   Tabs: 'tabs.<group>' settings row holds a JSON array of {key, label} —
//   order and labels only; routes always come from the hardcoded defaults.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getAllListOptions, getSettingValue } from '@/server/settings'
import { ALL_LIST_KEYS, type ListOptionRow } from '@/lib/lists'
import { resolveTabs, TAB_DEFAULTS, TAB_GROUPS, type TabDef, type TabGroup } from '@/lib/tabs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class SettingsError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof SettingsError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('settings action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

export type ListMutationResult = { ok: true; options: ListOptionRow[] } | { ok: false; error: string }

const listKeySchema = z.string().refine((k): k is (typeof ALL_LIST_KEYS)[number] => (ALL_LIST_KEYS as string[]).includes(k), 'Unknown list')

// ------------------------------------------------------------- add a value

export async function addListOption(rawKey: string, rawValue: string): Promise<ListMutationResult> {
  try {
    const key = listKeySchema.parse(rawKey)
    const value = z.string().trim().min(1, 'Type the value first').max(60).parse(rawValue)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [existing] = await tx<{ id: string; status: string }[]>`
        select id, status from list_options
        where restaurant_id = ${rid} and list_key = ${key} and lower(value) = lower(${value})`
      if (existing) {
        if (existing.status === 'active') throw new SettingsError('That value is already on the list')
        await tx`update list_options set status = 'active'
                 where id = ${existing.id} and restaurant_id = ${rid}`
        return
      }
      const [{ next }] = await tx<{ next: number }[]>`
        select coalesce(max(sort_order), 0) + 1 as next
        from list_options where restaurant_id = ${rid} and list_key = ${key}`
      await tx`
        insert into list_options (restaurant_id, list_key, value, sort_order)
        values (${rid}, ${key}, ${value}, ${next})`
    })

    return { ok: true, options: await getAllListOptions(rid) }
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------- reorder within its list

export async function moveListOption(id: string, dir: 'up' | 'down'): Promise<ListMutationResult> {
  try {
    if (!UUID.test(id)) throw new SettingsError('Malformed option id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [row] = await tx<{ id: string; list_key: string; sort_order: number }[]>`
        select id, list_key, sort_order from list_options
        where id = ${id} and restaurant_id = ${rid}`
      if (!row) throw new SettingsError('Option not found')
      // Renumber the whole list 1..n first so swaps are always clean, then swap.
      const all = await tx<{ id: string }[]>`
        select id from list_options
        where restaurant_id = ${rid} and list_key = ${row.list_key}
        order by sort_order asc, value asc`
      const idx = all.findIndex((o) => o.id === id)
      const swapWith = dir === 'up' ? idx - 1 : idx + 1
      if (swapWith < 0 || swapWith >= all.length) return // already at the edge — nothing to do
      const order = all.map((o) => o.id)
      ;[order[idx], order[swapWith]] = [order[swapWith], order[idx]]
      for (const [i, oid] of order.entries()) {
        await tx`update list_options set sort_order = ${i + 1}
                 where id = ${oid} and restaurant_id = ${rid}`
      }
    })

    return { ok: true, options: await getAllListOptions(rid) }
  } catch (e) {
    return fail(e)
  }
}

// -------------------------------------------------------- retire / restore

export async function setListOptionStatus(id: string, status: 'active' | 'inactive'): Promise<ListMutationResult> {
  try {
    if (!UUID.test(id)) throw new SettingsError('Malformed option id')
    z.enum(['active', 'inactive']).parse(status)
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const updated = await sql<{ id: string }[]>`
      update list_options set status = ${status}
      where id = ${id} and restaurant_id = ${rid}
      returning id`
    if (!updated[0]) throw new SettingsError('Option not found')
    return { ok: true, options: await getAllListOptions(rid) }
  } catch (e) {
    return fail(e)
  }
}

// ----------------------------------------------------------- tab settings

export type SaveTabsResult = { ok: true; tabs: TabDef[] } | { ok: false; error: string }

const TabsSchema = z.array(z.object({ key: z.string().min(1).max(30), label: z.string().trim().max(24) })).max(20)

export async function saveTabsSetting(rawGroup: string, rawEntries: { key: string; label: string }[]): Promise<SaveTabsResult> {
  try {
    const group = z
      .string()
      .refine((g): g is TabGroup => (TAB_GROUPS as string[]).includes(g), 'Unknown tab group')
      .parse(rawGroup)
    const entries = TabsSchema.parse(rawEntries)
    const validKeys = new Set(TAB_DEFAULTS[group].map((t) => t.key))
    const seen = new Set<string>()
    for (const e of entries) {
      if (!validKeys.has(e.key)) throw new SettingsError(`Unknown tab “${e.key}” for ${group}`)
      if (seen.has(e.key)) throw new SettingsError(`Tab “${e.key}” appears twice`)
      seen.add(e.key)
    }
    if (seen.size !== validKeys.size) throw new SettingsError('Every tab must stay on the strip — reorder or relabel, never remove')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const value = JSON.stringify(entries.map((e) => ({ key: e.key, label: e.label })))

    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      await tx`
        insert into settings (restaurant_id, key, value)
        values (${rid}, ${'tabs.' + group}, ${value})
        on conflict (restaurant_id, key) do update set value = excluded.value`
    })

    const raw = await getSettingValue(rid, `tabs.${group}`)
    if (raw !== value) throw new SettingsError('Could not verify the setting after save')
    return { ok: true, tabs: resolveTabs(group, raw) }
  } catch (e) {
    return fail(e)
  }
}

// ─────────────────────────── departments (sections) ───────────────────────
// sections is ONE table: the same row codes a dish (CH-001), receives an
// issue and posts a staff member. So a rename here reflects in all three
// with nothing else to update — which is exactly why the NAME is editable
// and the CODE is not. Dish codes and issue history carry the code forever.
//
// Retire, never delete.

const DeptSchema = z.object({
  name: z.string().trim().min(1, 'Name the department').max(60),
  sortOrder: z.union([z.literal(''), z.string().regex(/^\d{1,4}$/)]),
  status: z.enum(['active', 'inactive']),
})

const NewDeptSchema = DeptSchema.extend({
  code: z.string().trim().min(2, 'A code is 2 letters').max(4).regex(/^[A-Za-z]+$/, 'Letters only'),
  deptGroup: z.enum(['Management', 'Support', 'Kitchen', 'Service', 'Bar']),
  deptKind: z.enum(['kitchen', 'operational']),
  // Only a department that COOKS may code a dish. Security receives issues
  // and posts staff but no dish was ever a Security dish, and the code is
  // permanent once a dish carries it.
  codesDishes: z.boolean(),
  receivesStock: z.boolean(),
})

export async function createDepartment(raw: {
  name: string
  code: string
  deptGroup: string
  deptKind: string
  codesDishes: boolean
  receivesStock: boolean
  sortOrder: string
  status: 'active' | 'inactive'
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = NewDeptSchema.parse(raw)
    if (input.codesDishes && input.deptKind !== 'kitchen') {
      throw new SettingsError('Only a kitchen department can code dishes')
    }
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const code = input.code.toUpperCase()

    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const dup = await tx<{ id: string }[]>`
        select id from sections where restaurant_id = ${rid} and code = ${code}`
      if (dup[0]) throw new SettingsError(`Code ${code} is already used — codes are permanent and never reused`)
      const [{ next }] = await tx<{ next: number }[]>`
        select coalesce(max(sort_order), 0) + 1 as next from sections where restaurant_id = ${rid}`
      await tx`
        insert into sections (restaurant_id, code, name, dept_group, dept_kind, codes_dishes, receives_stock, sort_order, status)
        values (${rid}, ${code}, ${input.name}, ${input.deptGroup}, ${input.deptKind}, ${input.codesDishes},
                ${input.receivesStock},
                ${input.sortOrder === '' ? next : Number(input.sortOrder)}, ${input.status})`
    })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function updateDepartment(
  id: string,
  raw: { name: string; sortOrder: string; status: 'active' | 'inactive'; receivesStock: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SettingsError('Malformed department id')
    const input = DeptSchema.parse(raw)
    const restaurant = await getRestaurant()

    // code and dept_group stay absent by design — the code is part of every
    // dish code and cannot be moved. receives_stock CAN change: a department
    // starts consuming, or stops, and that is a fact about today rather than
    // an identity.
    const updated = await sql<{ id: string }[]>`
      update sections set
        name = ${input.name},
        sort_order = ${input.sortOrder === '' ? sql`sort_order` : Number(input.sortOrder)},
        receives_stock = ${raw.receivesStock},
        status = ${input.status}
      where id = ${id} and restaurant_id = ${restaurant.id}
      returning id`
    if (!updated[0]) throw new SettingsError('Department not found — nothing was changed')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ─────────────────── inline list additions, and their approval ────────────
//
// The rule that changed: a list field now ACCEPTS a value that is not on the
// list. It saves, and the value lands in list_suggestions as pending. The
// person entering never waits for an owner; the owner still decides what
// becomes vocabulary. seen_count is the signal — a word typed nine times is
// real, a word typed once may be a typo.

/** Record a typed-but-unlisted value. Safe to call on every save: a repeat
 *  bumps seen_count rather than making a second row. Never throws — a
 *  failure here must not lose the entry it was attached to. */
export async function noteListSuggestion(
  restaurantId: string,
  listKey: string,
  value: string,
  suggestedBy: string | null,
): Promise<void> {
  const clean = value.trim()
  if (clean === '') return
  try {
    const [existing] = await sql<{ id: string; seen_count: number }[]>`
      select id, seen_count from list_suggestions
      where restaurant_id = ${restaurantId} and list_key = ${listKey}
        and lower(value) = ${clean.toLowerCase()}`
    if (existing) {
      await sql`update list_suggestions set seen_count = ${existing.seen_count + 1}
                where id = ${existing.id} and restaurant_id = ${restaurantId}`
    } else {
      await sql`
        insert into list_suggestions (restaurant_id, list_key, value, suggested_by, seen_count, status)
        values (${restaurantId}, ${listKey}, ${clean}, ${suggestedBy}, 1, 'pending')`
    }
  } catch (e) {
    // deliberately swallowed: the entry is already saved and matters more
    console.error('could not note list suggestion', e)
  }
}

/** Owner approves a pending value into the real list.
 *
 * For expense_category the approval ALSO classifies it, because the P&L
 * splits controllable from occupancy and an unclassified category would
 * quietly land in neither. That is why `kind` is required for that one key
 * and refused for every other. */
export async function approveSuggestion(
  id: string,
  kind?: 'controllable' | 'occupancy',
): Promise<ListMutationResult> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SettingsError('Malformed suggestion id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await sql.begin(async (tx) => {
      const [sug] = await tx<{ list_key: string; value: string }[]>`
        select list_key, value from list_suggestions
        where id = ${id} and restaurant_id = ${rid} and status = 'pending'`
      if (!sug) throw new SettingsError('That suggestion is no longer pending')

      if (sug.list_key === 'expense_category') {
        if (kind === undefined) {
          throw new SettingsError(
            'An expense category needs to be marked controllable or occupancy — the P&L splits on it',
          )
        }
        const [already] = await tx<{ category: string }[]>`
          select category from expense_category_kinds
          where restaurant_id = ${rid} and category = ${sug.value}`
        if (already) {
          await tx`update expense_category_kinds set kind = ${kind}
                   where restaurant_id = ${rid} and category = ${sug.value}`
        } else {
          await tx`insert into expense_category_kinds (restaurant_id, category, kind)
                   values (${rid}, ${sug.value}, ${kind})`
        }
      } else if (kind !== undefined) {
        throw new SettingsError('Only expense categories carry a controllable/occupancy split')
      }

      const [dup] = await tx<{ id: string }[]>`
        select id from list_options
        where restaurant_id = ${rid} and list_key = ${sug.list_key} and lower(value) = ${sug.value.toLowerCase()}`
      if (dup) {
        await tx`update list_options set status = 'active'
                 where id = ${dup.id} and restaurant_id = ${rid}`
      } else {
        const [{ next }] = await tx<{ next: number }[]>`
          select coalesce(max(sort_order), 0) + 1 as next from list_options
          where restaurant_id = ${rid} and list_key = ${sug.list_key}`
        await tx`insert into list_options (restaurant_id, list_key, value, sort_order)
                 values (${rid}, ${sug.list_key}, ${sug.value}, ${next})`
      }
      await tx`update list_suggestions set status = 'accepted'
                 where id = ${id} and restaurant_id = ${rid}`
    })

    return { ok: true, options: await getAllListOptions(rid) }
  } catch (e) {
    return fail(e)
  }
}

/** Owner rejects it. The events that already used the value keep it —
 *  nothing is rewritten — it simply stops being offered. */
export async function rejectSuggestion(id: string): Promise<ListMutationResult> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SettingsError('Malformed suggestion id')
    const restaurant = await getRestaurant()
    const updated = await sql<{ id: string }[]>`
      update list_suggestions set status = 'rejected'
      where id = ${id} and restaurant_id = ${restaurant.id} and status = 'pending'
      returning id`
    if (!updated[0]) throw new SettingsError('That suggestion is no longer pending')
    return { ok: true, options: await getAllListOptions(restaurant.id) }
  } catch (e) {
    return fail(e)
  }
}

/** Classify an already-approved expense category. */
export async function setExpenseKind(
  category: string,
  kind: 'controllable' | 'occupancy',
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const [already] = await sql<{ category: string }[]>`
      select category from expense_category_kinds where restaurant_id = ${rid} and category = ${category}`
    if (already) {
      await sql`update expense_category_kinds set kind = ${kind}
                where restaurant_id = ${rid} and category = ${category}`
    } else {
      await sql`insert into expense_category_kinds (restaurant_id, category, kind)
                values (${rid}, ${category}, ${kind})`
    }
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
