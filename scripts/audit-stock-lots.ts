// READ-ONLY post-migration inventory reconciliation.
//
// The legacy aggregate book does not contain historical receipt-to-issue
// provenance, so this command does not manufacture FIFO history. It proves
// the safer invariant: current positive lot balances equal current aggregate
// on-hand for every item, and identifies any residual lot-only or aggregate-
// only quantity for the migration owner to investigate.

import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

type Row = { item_id: string; item_code: string; item_name: string; aggregate_qty: string; lot_qty: string }

async function main() {
  const { withTenant } = await import('../src/lib/tenant')
  const { tsql } = await import('../src/lib/db')
  const restaurantId = process.env.KB_LIVE_TENANT?.trim()
  assert.ok(restaurantId, 'KB_LIVE_TENANT is required; the audit will never guess a tenant')

  const rows = await withTenant(restaurantId, () => tsql<Row[]>`
    with aggregate as (
      select item_id, sum(on_hand_qty) as quantity
      from stock_on_hand
      where restaurant_id = ${restaurantId}
      group by item_id
    ), lot_movements as (
      select l.item_id, l.restaurant_id, l.initial_qty as quantity
      from stock_lots l
      where l.restaurant_id = ${restaurantId}
      union all
      select l.item_id, m.restaurant_id, m.quantity_delta
      from stock_lot_movements m
      join stock_lots l on l.restaurant_id = m.restaurant_id and l.id = m.lot_id
      where m.restaurant_id = ${restaurantId}
    ), lots as (
      select item_id, restaurant_id, sum(quantity) as quantity
      from lot_movements
      group by item_id, restaurant_id
    )
    select i.id as item_id, i.code as item_code, i.name as item_name,
           coalesce(a.quantity, 0)::text as aggregate_qty,
           coalesce(l.quantity, 0)::text as lot_qty
    from items i
    left join aggregate a on a.item_id = i.id
    left join lots l on l.restaurant_id = i.restaurant_id and l.item_id = i.id
    where i.restaurant_id = ${restaurantId}
      and (coalesce(a.quantity, 0) <> 0 or coalesce(l.quantity, 0) <> 0)
      and round(coalesce(a.quantity, 0), 3) <> round(coalesce(l.quantity, 0), 3)
    order by i.code`)

  if (rows.length === 0) {
    console.log('stock-lot audit — clean: aggregate on-hand equals lot-ledger quantity')
    return
  }
  console.error(`stock-lot audit — ${rows.length} item(s) need reconciliation`)
  for (const row of rows) console.error(`  ${row.item_code} · ${row.item_name}: aggregate ${row.aggregate_qty}, lots ${row.lot_qty}`)
  process.exitCode = 1
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
