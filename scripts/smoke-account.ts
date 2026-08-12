// Every money form now refuses a blank account (Phase C, commit 1), so every
// smoke needs one real account to name. Find-or-create a Zz-prefixed test
// account: the assertions stay about the module under test rather than about
// whichever accounts happen to exist in the database on the day it runs.
//
// The id is printed for the cleanup pass, like every other row a smoke makes.
export async function ensureSmokeAccount(restaurantId: string): Promise<string> {
  const { sql } = await import('../src/lib/db')
  const name = 'Zz Smoke Drawer'
  const [existing] = (await sql`
    select id from money_accounts
    where restaurant_id = ${restaurantId} and name = ${name}`) as unknown as { id: string }[]
  if (existing) return existing.id
  const [row] = (await sql`
    insert into money_accounts (restaurant_id, name, kind, sort_order, status)
    values (${restaurantId}, ${name}, 'cash', 999, 'active')
    returning id`) as unknown as { id: string }[]
  console.log('created money_account (cleanup):', row.id, name)
  return row.id
}
