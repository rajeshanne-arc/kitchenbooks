'use server'

import { z } from 'zod'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { listTransfers, type StockTransferRow } from '@/server/transfer-queries'
import { locationLotBalance, transferLot } from '@/server/lot-ledger'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const Schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), fromLocationId: z.string().regex(UUID), toLocationId: z.string().regex(UUID), note: z.string().trim().max(300), lines: z.array(z.object({ itemId: z.string().regex(UUID), qty: z.string().regex(/^\d{1,8}(\.\d{1,3})?$/) })).min(1).max(100) })
export type TransferResult = { ok: true; transfers: StockTransferRow[] } | { ok: false; error: string }

export async function saveStockTransfer(raw: unknown): Promise<TransferResult> {
  try {
    const input = Schema.parse(raw)
    const actor = await getSessionUser()
    if (!actor || !['store', 'manager', 'owner'].includes(actor.role)) throw new Error('Only the store, a manager, or an owner can transfer stock')
    if (input.fromLocationId === input.toLocationId) throw new Error('Choose two different storage locations')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const ids = input.lines.map((line) => line.itemId)
    if (new Set(ids).size !== ids.length) throw new Error('The same item is listed twice — combine it into one line')
    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const locations = await tx<{ id: string; status: string }[]>`select id, status from storage_locations where restaurant_id = ${rid} and (id = ${input.fromLocationId} or id = ${input.toLocationId})`
      if (locations.length !== 2 || locations.some((location) => location.status !== 'active')) throw new Error('Both storage locations must be active in this restaurant')
      const [transfer] = await tx<{ id: string }[]>`insert into stock_transfers (restaurant_id, transfer_date, from_location_id, to_location_id, note, entered_by) values (${rid}, ${input.date}, ${input.fromLocationId}, ${input.toLocationId}, ${input.note === '' ? null : input.note}, ${actor.username}) returning id`
      for (const line of input.lines) {
        const [item] = await tx<{ id: string; total_on_hand: string }[]>`select i.id, (select s.on_hand_qty::text from stock_on_hand s where s.restaurant_id = i.restaurant_id and s.item_id = i.id) as total_on_hand from items i where i.restaurant_id = ${rid} and i.id = ${line.itemId} and i.status = 'active' for update`
        if (!item) throw new Error('An item is missing or has no stock record')
        const available = await locationLotBalance(tx, rid, line.itemId, input.fromLocationId)
        if (Number(line.qty) <= 0 || Number(line.qty) > Number(available)) throw new Error(`Transfer quantity must be between zero and the source-location stock (${available})`)
        const [transferLine] = await tx<{ id: string }[]>`insert into stock_transfer_lines (restaurant_id, transfer_id, item_id, qty) values (${rid}, ${transfer.id}, ${line.itemId}, ${line.qty}::numeric) returning id`
        await transferLot(tx, rid, transfer.id, transferLine.id, line.itemId, line.qty, input.fromLocationId, input.toLocationId, input.date, actor.username)
        if (line.qty === item.total_on_hand) await tx`update items set storage_location_id = ${input.toLocationId} where restaurant_id = ${rid} and id = ${line.itemId}`
      }
    })
    return { ok: true, transfers: await listTransfers(rid) }
  } catch (error) {
    return { ok: false, error: error instanceof z.ZodError ? 'The transfer fields are invalid' : error instanceof Error ? error.message : 'The transfer could not be saved' }
  }
}
