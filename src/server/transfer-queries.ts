import 'server-only'
import { tsql } from '@/lib/db'

export type TransferableItem = { id: string; code: string; name: string; purchase_unit: string; location_id: string; location_name: string; on_hand_qty: string }
export type StockTransferRow = { id: string; transfer_date: string; from_location: string; to_location: string; note: string | null; entered_by: string | null; lines: number }

export async function listTransferableItems(restaurantId: string): Promise<TransferableItem[]> {
  return tsql<TransferableItem[]>`
    with balances as (
      select l.id, l.restaurant_id, l.item_id, l.location_id, l.initial_qty as quantity
      from stock_lots l where l.restaurant_id = ${restaurantId} and l.location_id is not null
      union all
      select m.lot_id, m.restaurant_id, l.item_id, m.location_id, m.quantity_delta
      from stock_lot_movements m join stock_lots l on l.restaurant_id = m.restaurant_id and l.id = m.lot_id
      where m.restaurant_id = ${restaurantId} and m.location_id is not null
    )
    select i.id, i.code, i.name, i.purchase_unit, b.location_id, loc.name as location_name,
           sum(b.quantity)::text as on_hand_qty
    from balances b
    join items i on i.restaurant_id = b.restaurant_id and i.id = b.item_id and i.status = 'active'
    join storage_locations loc on loc.restaurant_id = b.restaurant_id and loc.id = b.location_id and loc.status = 'active'
    group by i.id, i.code, i.name, i.purchase_unit, b.location_id, loc.name
    having sum(b.quantity) > 0
    order by loc.name, i.code`
}

export async function listTransfers(restaurantId: string, limit = 30): Promise<StockTransferRow[]> {
  return tsql<StockTransferRow[]>`select t.id, t.transfer_date::text as transfer_date, f.name as from_location, d.name as to_location, t.note, t.entered_by, (select count(*)::int from stock_transfer_lines l where l.restaurant_id = t.restaurant_id and l.transfer_id = t.id) as lines from stock_transfers t join storage_locations f on f.restaurant_id = t.restaurant_id and f.id = t.from_location_id join storage_locations d on d.restaurant_id = t.restaurant_id and d.id = t.to_location_id where t.restaurant_id = ${restaurantId} order by t.transfer_date desc, t.created_at desc limit ${limit}`
}
