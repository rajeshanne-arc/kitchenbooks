// Every money form now refuses a blank account (Phase C, commit 1), so every
// smoke needs one real account to name. Find-or-create a Zz-prefixed test
// account: the assertions stay about the module under test rather than about
// whichever accounts happen to exist in the database on the day it runs.
//
// The id is printed for the cleanup pass, like every other row a smoke makes.
export async function ensureSmokeAccount(restaurantId: string): Promise<string> {
  const { tsql } = await import('../src/lib/db')
  const name = 'Zz Smoke Drawer'
  const [mapped] = await tsql<{ account_id: string }[]>`
    select account_id from accounting_posting_mappings
    where restaurant_id = ${restaurantId} and mapping_key = 'pos_cash_asset'`
  if (!mapped) throw new Error('The disposable tenant has no pos_cash_asset mapping for the smoke account')
  const [existing] = await tsql<{ id: string; accounting_account_id: string | null }[]>`
    select id, accounting_account_id from money_accounts
    where restaurant_id = ${restaurantId} and name = ${name}`
  if (existing) {
    if (existing.accounting_account_id !== mapped.account_id) {
      await tsql`
        update money_accounts
        set accounting_account_id = ${mapped.account_id}
        where restaurant_id = ${restaurantId} and id = ${existing.id}`
    }
    return existing.id
  }
  const [row] = await tsql<{ id: string }[]>`
    insert into money_accounts (restaurant_id, name, kind, sort_order, status, accounting_account_id)
    values (${restaurantId}, ${name}, 'cash', 999, 'active', ${mapped.account_id})
    returning id`
  console.log('created money_account (cleanup):', row.id, name)
  return row.id
}
