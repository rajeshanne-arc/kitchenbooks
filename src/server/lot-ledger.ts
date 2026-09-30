import type postgres from 'postgres'

type Lot = { id: string; location_id: string | null; available: string }

export async function recordAdjustmentLot(tx: postgres.TransactionSql, restaurantId: string, adjustmentId: string, itemId: string, quantity: string, unitCost: string, date: string, enteredBy: string | null) {
  const amount = Number(quantity)
  if (!Number.isFinite(amount) || amount === 0) return
  if (amount > 0) {
    const [item] = await tx<{ location_id: string | null }[]>`select storage_location_id as location_id from items where restaurant_id = ${restaurantId} and id = ${itemId}`
    await tx`insert into stock_lots (restaurant_id, item_id, lot_code, received_date, initial_qty, unit_cost, location_id) values (${restaurantId}, ${itemId}, 'ADJUSTMENT-' || ${adjustmentId}, ${date}, ${quantity}, ${unitCost}, ${item?.location_id ?? null})`
    return
  }
  await allocateLotDelta(tx, restaurantId, itemId, String(-amount), adjustmentId, adjustmentId, date, enteredBy, 'adjustment')
}

export async function createReturnLot(tx: postgres.TransactionSql, restaurantId: string, returnId: string, returnLineId: string, itemId: string, quantity: string, unitCost: string, date: string, enteredBy: string | null) {
  const [item] = await tx<{ location_id: string | null }[]>`select storage_location_id as location_id from items where restaurant_id = ${restaurantId} and id = ${itemId}`
  await tx`insert into stock_lots (restaurant_id, item_id, lot_code, received_date, initial_qty, unit_cost, location_id) values (${restaurantId}, ${itemId}, 'RETURN-' || ${returnLineId}, ${date}, ${quantity}, ${unitCost}, ${item?.location_id ?? null})`
  void returnId; void enteredBy
}

export async function recordWastageLot(tx: postgres.TransactionSql, restaurantId: string, wastageId: string, itemId: string, quantity: string, date: string, enteredBy: string | null) {
  await allocateLotDelta(tx, restaurantId, itemId, quantity, wastageId, wastageId, date, enteredBy, 'wastage')
}

/** Create one immutable lot for each new purchase line. The migration is a
 * deployment prerequisite; this function deliberately does not silently fall
 * back to the old aggregate model. */
export async function createPurchaseLots(tx: postgres.TransactionSql, restaurantId: string, purchaseId: string, enteredBy: string | null) {
  await tx`
    insert into stock_lots
      (restaurant_id, item_id, lot_code, received_date, expiry_date, initial_qty,
       unit_cost, location_id, source_purchase_line_id)
    select pl.restaurant_id, pl.item_id,
           'PURCHASE-' || pl.purchase_id::text || '-' || pl.id::text,
           p.bill_date, pl.expiry_date, pl.qty, pl.rate, i.storage_location_id, pl.id
    from purchase_lines pl
    join purchases p on p.restaurant_id = pl.restaurant_id and p.id = pl.purchase_id
    join items i on i.restaurant_id = pl.restaurant_id and i.id = pl.item_id
    where pl.restaurant_id = ${restaurantId} and pl.purchase_id = ${purchaseId}
      and not exists (select 1 from stock_lots l where l.restaurant_id = pl.restaurant_id and l.source_purchase_line_id = pl.id)`
  // Keep the write path explicit in the function signature: the source actor
  // belongs on movement records, while the lot itself is a receipt snapshot.
  void enteredBy
}

/** Allocate an issue by FEFO. Legacy aggregate stock is a valid fallback lot,
 * but it sorts last and is visibly labelled in the inventory read model. */
export async function allocateIssueLot(tx: postgres.TransactionSql, restaurantId: string, itemId: string, quantity: string, issueId: string, issueLineId: string, date: string, enteredBy: string | null) {
  await allocateLotDelta(tx, restaurantId, itemId, quantity, issueId, issueLineId, date, enteredBy, 'issue')
}

async function allocateLotDelta(tx: postgres.TransactionSql, restaurantId: string, itemId: string, quantity: string, sourceId: string, sourceLineId: string, date: string, enteredBy: string | null, movementType: 'issue' | 'adjustment' | 'wastage') {
  await tx`select id from stock_lots where restaurant_id = ${restaurantId} and item_id = ${itemId} for update`
  const lots = await tx<Lot[]>`
    with balances as (
      select l.id, l.location_id, l.initial_qty as quantity
      from stock_lots l
      where l.restaurant_id = ${restaurantId} and l.item_id = ${itemId}
      union all
      select m.lot_id, m.location_id, m.quantity_delta
      from stock_lot_movements m
      where m.restaurant_id = ${restaurantId} and m.lot_id in (select id from stock_lots where restaurant_id = ${restaurantId} and item_id = ${itemId})
    )
    select b.id, b.location_id, sum(b.quantity)::text as available
    from balances b
    join stock_lots l on l.restaurant_id = ${restaurantId} and l.id = b.id
    where l.restaurant_id = ${restaurantId} and l.item_id = ${itemId}
    group by b.id, b.location_id, l.expiry_date, l.received_date, l.lot_code
    having sum(b.quantity) > 0
    order by (l.expiry_date is null), l.expiry_date asc nulls last, l.received_date asc, l.lot_code asc`
  let remaining = Number(quantity)
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('Issue quantity must be positive')
  for (const lot of lots) {
    if (remaining <= 0) break
    const take = Math.min(remaining, Number(lot.available))
    if (take <= 0) continue
    await tx`insert into stock_lot_movements (restaurant_id, lot_id, quantity_delta, movement_date, movement_type, source_id, source_line_id, location_id, entered_by) values (${restaurantId}, ${lot.id}, ${(-take).toFixed(3)}, ${date}, ${movementType}, ${sourceId}, ${sourceLineId}, ${lot.location_id}, ${enteredBy})`
    remaining = Number((remaining - take).toFixed(3))
  }
  if (remaining > 0) throw new Error('Not enough lot-tracked stock is available for this issue')
}

export async function transferLot(tx: postgres.TransactionSql, restaurantId: string, transferId: string, lineId: string, itemId: string, quantity: string, fromLocationId: string, toLocationId: string, date: string, enteredBy: string | null) {
  await tx`select id from stock_lots where restaurant_id = ${restaurantId} and item_id = ${itemId} for update`
  const lots = await tx<Lot[]>`
    with balances as (
      select l.id, l.location_id, l.initial_qty as quantity from stock_lots l where l.restaurant_id = ${restaurantId} and l.item_id = ${itemId} and l.location_id is not null
      union all
      select m.lot_id, m.location_id, m.quantity_delta from stock_lot_movements m where m.restaurant_id = ${restaurantId} and m.location_id is not null and m.lot_id in (select id from stock_lots where restaurant_id = ${restaurantId} and item_id = ${itemId})
    )
    select b.id, b.location_id, sum(b.quantity)::text as available from balances b join stock_lots l on l.restaurant_id = ${restaurantId} and l.id = b.id
    where b.location_id = ${fromLocationId} group by b.id, b.location_id, l.expiry_date, l.received_date, l.lot_code
    having sum(b.quantity) > 0 order by (l.expiry_date is null), l.expiry_date asc nulls last, l.received_date asc, l.lot_code asc`
  let remaining = Number(quantity)
  for (const lot of lots) {
    if (remaining <= 0) break
    const take = Math.min(remaining, Number(lot.available))
    await tx`insert into stock_lot_movements (restaurant_id, lot_id, quantity_delta, movement_date, movement_type, source_id, source_line_id, location_id, from_location_id, to_location_id, entered_by) values (${restaurantId}, ${lot.id}, ${(-take).toFixed(3)}, ${date}, 'transfer', ${transferId}, ${lineId}, ${fromLocationId}, ${fromLocationId}, ${toLocationId}, ${enteredBy}), (${restaurantId}, ${lot.id}, ${take.toFixed(3)}, ${date}, 'transfer', ${transferId}, ${lineId}, ${toLocationId}, ${fromLocationId}, ${toLocationId}, ${enteredBy})`
    remaining = Number((remaining - take).toFixed(3))
  }
  if (remaining > 0) throw new Error('Not enough stock is available in the source location')
}

export async function locationLotBalance(tx: postgres.TransactionSql, restaurantId: string, itemId: string, locationId: string): Promise<string> {
  const [row] = await tx<{ available: string }[]>`
    with balances as (
      select l.id, l.location_id, l.initial_qty as quantity from stock_lots l where l.restaurant_id = ${restaurantId} and l.item_id = ${itemId} and l.location_id is not null
      union all
      select m.lot_id, m.location_id, m.quantity_delta from stock_lot_movements m where m.restaurant_id = ${restaurantId} and m.location_id is not null
    )
    select coalesce(sum(b.quantity), 0)::text as available
    from balances b join stock_lots l on l.restaurant_id = ${restaurantId} and l.id = b.id
    where l.item_id = ${itemId} and b.location_id = ${locationId}`
  return row?.available ?? '0'
}
