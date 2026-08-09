// Read-side queries. Every derived number a screen displays comes from a
// named view here (vendor_dues.balance, item_rates.prefill_rate) — never a
// re-computation of the same figure in JS.
import 'server-only'
import { sql } from '@/lib/db'
import type { Category, ItemHit, ItemHitExisting, ItemHitStarter, Restaurant, Unit, VendorHit } from '@/lib/types'

let restaurantCache: Restaurant | null = null

/** The single restaurant row (Thrayam for now). Cached per server instance. */
export async function getRestaurant(): Promise<Restaurant> {
  if (restaurantCache) return restaurantCache
  const rows = await sql<Restaurant[]>`select id, name from restaurants order by created_at asc limit 1`
  if (!rows[0]) throw new Error('No restaurant row found — seed the restaurants table first')
  restaurantCache = rows[0]
  return rows[0]
}

export async function getMasters(): Promise<{ categories: Category[]; units: Unit[] }> {
  const [categories, units] = await Promise.all([
    sql<Category[]>`select code, name, kind, sort_order from categories where status = 'active' order by sort_order asc`,
    sql<Unit[]>`select code, name from units order by name asc`,
  ])
  return { categories, units }
}

export async function searchVendors(restaurantId: string, q: string): Promise<VendorHit[]> {
  const like = `%${q}%`
  const prefix = `${q}%`
  const rows = await sql<VendorHit[]>`
    select v.id, v.code, v.name, v.primary_category, c.name as category_name,
           coalesce(d.balance, 0)::text as balance
    from vendors v
    join categories c on c.code = v.primary_category
    left join vendor_dues d on d.vendor_id = v.id
    where v.restaurant_id = ${restaurantId} and v.status = 'active' and v.name ilike ${like}
    order by (v.name ilike ${prefix}) desc, v.name asc
    limit 8`
  return rows
}

/**
 * Typeahead over the restaurant's items plus starter-library suggestions.
 * Starter rows whose name is already materialized as an item are excluded,
 * so a suggestion never duplicates something that exists.
 */
export async function searchItems(restaurantId: string, q: string): Promise<ItemHit[]> {
  const like = `%${q}%`
  const prefix = `${q}%`
  const items = await sql<Omit<ItemHitExisting, 'kind'>[]>`
    select i.id, i.code, i.name, i.category, c.name as category_name,
           i.purchase_unit, u.name as unit_name, r.prefill_rate::text as prefill_rate
    from items i
    join categories c on c.code = i.category
    join units u on u.code = i.purchase_unit
    left join item_rates r on r.item_id = i.id
    where i.restaurant_id = ${restaurantId} and i.status = 'active' and i.name ilike ${like}
    order by (i.name ilike ${prefix}) desc, i.name asc
    limit 8`
  const starters = await sql<Omit<ItemHitStarter, 'kind'>[]>`
    select s.id as starter_id, s.name, s.category, c.name as category_name,
           s.purchase_unit, u.name as unit_name
    from starter_library s
    join categories c on c.code = s.category
    join units u on u.code = s.purchase_unit
    where c.status = 'active'
      and s.name ilike ${like}
      and not exists (
        select 1 from items i
        where i.restaurant_id = ${restaurantId} and lower(i.name) = lower(s.name)
      )
    order by (s.name ilike ${prefix}) desc, s.name asc
    limit ${Math.max(4, 12 - items.length)}`
  return [
    ...items.map((r) => ({ kind: 'item' as const, ...r })),
    ...starters.map((r) => ({ kind: 'starter' as const, ...r })),
  ]
}
