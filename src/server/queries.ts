// Read-side queries. Every derived number a screen displays comes from a
// named view here (vendor_dues.balance, item_rates.prefill_rate) — never a
// re-computation of the same figure in JS.
import 'server-only'
import { tsql } from '@/lib/db'
import type { Category, ItemHit, ItemHitExisting, ItemHitStarter, Restaurant, Unit, VendorHit } from '@/lib/types'


/**
 * WHICH BOOKS AM I IN. Derived from the session, never from a query.
 *
 * This used to be `select … from restaurants order by created_at asc
 * limit 1` — the OLDEST row, with no reference to who was logged in — and
 * `getSessionUser` matched on username alone. Together those were ONE
 * fault, not two: anyone holding valid credentials for tenant #2 logged in
 * and operated on tenant #1's books. Reads AND writes.
 *
 * The result was also cached in a module-level variable, which on Fluid
 * Compute is process-wide across concurrent requests on the same instance —
 * so even a correct per-request lookup would have been poisoned by whoever
 * asked first. That cache is gone and must not come back.
 *
 * THE FALLBACK IS PROVABLY UNAMBIGUOUS, which is why it is allowed to
 * exist. Outside a request — smoke suites, build-time — there is no
 * session; the fallback answers only while the database holds EXACTLY ONE
 * restaurant, because then there is only one possible answer and it cannot
 * be the wrong one. The moment a second tenant exists it refuses by name.
 * A guess that cannot be wrong is not a guess; a guess that could be is the
 * bug this replaced.
 */
export async function getRestaurant(): Promise<Restaurant> {
  const { getSessionUser } = await import('@/server/current-user')
  const user = await getSessionUser()
  if (user) {
    const rows = await tsql<Restaurant[]>`
      select id, name from restaurants where id = ${user.restaurantId}`
    if (!rows[0]) throw new Error('The signed-in account points at a restaurant that no longer exists')
    return rows[0]
  }

  const rows = await tsql<Restaurant[]>`select id, name from restaurants order by created_at asc limit 2`
  if (!rows[0]) throw new Error('No restaurant row found — seed the restaurants table first')
  if (rows.length > 1) {
    throw new Error(
      'More than one restaurant exists and this call has no session to say which — every path must carry a tenant before a second tenant is created',
    )
  }
  return rows[0]
}

export async function getMasters(): Promise<{ categories: Category[]; units: Unit[] }> {
  const [categories, units] = await Promise.all([
    tsql<Category[]>`select code, name, kind, sort_order from categories where status = 'active' order by sort_order asc`,
    tsql<Unit[]>`select code, name from units order by name asc`,
  ])
  return { categories, units }
}

export async function searchVendors(restaurantId: string, q: string): Promise<VendorHit[]> {
  const like = `%${q}%`
  const prefix = `${q}%`
  const rows = await tsql<VendorHit[]>`
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
export async function searchItems(
  restaurantId: string,
  q: string,
  /** the vendor the bill is being entered for, when one is already picked.
   *  A vendor born on this same bill has no history, so this is null then. */
  vendorId: string | null = null,
): Promise<ItemHit[]> {
  const like = `%${q}%`
  const prefix = `${q}%`

  // WHAT THIS VENDOR HAS SUPPLIED, first. The vendor is picked before the lines
  // on every bill, so it is context the picker already has and was throwing
  // away — and the rate is half of why: item_rates.prefill_rate is the last
  // rate across ALL vendors, so a Sneha Chicken bill was prefilling RR
  // Chicken's ₹330 against Sneha's ₹300.
  //
  // FREQUENCY THEN RECENCY here, unlike a vendor RETURN, which ranks recency
  // first. Entering a bill, what this vendor usually sends is the better guess;
  // arguing about a return, the delivery in dispute is the one that just came
  // through the door.
  //
  // A SEPARATE QUERY rather than an ORDER BY on one, so the scoped group can
  // never crowd the general search out of the limit. Scoping must not exclude.
  const vendorItems =
    vendorId === null
      ? []
      : await tsql<Omit<ItemHitExisting, 'kind'>[]>`
          select i.id, i.code, i.name, i.category, c.name as category_name,
                 i.purchase_unit, u.name as unit_name,
                 v.last_rate::text as prefill_rate,
                 'vendor' as rate_source, true as from_vendor
          from vendor_supplied_items v
          join items i on i.id = v.item_id
          join categories c on c.code = i.category
          join units u on u.code = i.purchase_unit
          where v.restaurant_id = ${restaurantId}
            and v.vendor_id = ${vendorId}
            and i.status = 'active'
            and (i.name ilike ${like} or i.code ilike ${like})
          order by v.times_bought desc, v.last_bought desc, i.name asc
          limit 6`
  const seen = vendorItems.map((r) => r.id)

  // EVERYTHING ELSE, always reachable — a vendor can send something they have
  // never sent before, and a new item is born on a bill in the first place.
  const items = await tsql<Omit<ItemHitExisting, 'kind'>[]>`
    select i.id, i.code, i.name, i.category, c.name as category_name,
           i.purchase_unit, u.name as unit_name, r.prefill_rate::text as prefill_rate,
           case when r.prefill_rate is null then null else 'any' end as rate_source,
           false as from_vendor
    from items i
    join categories c on c.code = i.category
    join units u on u.code = i.purchase_unit
    left join item_rates r on r.item_id = i.id
    where i.restaurant_id = ${restaurantId} and i.status = 'active'
      -- BY CODE TOO. The codes are the spine of the product and this dropdown
      -- prints them, but this was the one picker in the app that matched only
      -- the name — so typing PLT-001 on a bill found nothing. Caught by an
      -- assertion that searched by code because that is what the view carries.
      and (i.name ilike ${like} or i.code ilike ${like})
      and not (i.id = any(${seen}::uuid[]))
    order by (i.name ilike ${prefix}) desc, i.name asc
    limit 8`
  const starters = await tsql<Omit<ItemHitStarter, 'kind'>[]>`
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
    limit ${Math.max(4, 12 - items.length - vendorItems.length)}`
  return [
    ...vendorItems.map((r) => ({ kind: 'item' as const, ...r })),
    ...items.map((r) => ({ kind: 'item' as const, ...r })),
    ...starters.map((r) => ({ kind: 'starter' as const, ...r })),
  ]
}
