// Parse + persist for Petpooja payloads. One fetch = ONE pos_fetches row
// plus its orders and lines in a single transaction; a re-fetch is a NEW
// fetch that wins via the latest_fetches view — nothing is ever edited.
//
// STATUS IS A WHITELIST: 'Success' -> revenue, 'Cancelled' -> cancelled,
// 'Complimentary' -> complimentary, ANYTHING ELSE -> unknown — surfaced
// loudly, never banked. C-prefixed order ids are a secondary comp signal;
// status wins, and every disagreement is logged on the fetch row.
import 'server-only'
import { sql } from '@/lib/db'
import type { StatusClass } from '@/lib/types'

export class SalesIngestError extends Error {}

export function classifyStatus(statusRaw: string): StatusClass {
  const s = statusRaw.trim().toLowerCase()
  if (s === 'success') return 'revenue'
  if (s === 'cancelled') return 'cancelled'
  if (s === 'complimentary') return 'complimentary'
  return 'unknown'
}

/** Petpooja numbers arrive as strings ("492", "-0.46") or bare JSON numbers
 * (service_charge). Normalize to a plain decimal string or null — never a
 * float into money columns. */
export function posNum(v: unknown): string | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    return Number.isInteger(v) ? String(v) : v.toFixed(2)
  }
  if (typeof v !== 'string') return null
  const s = v.trim()
  return /^-?\d{1,10}(\.\d{1,6})?$/.test(s) ? s : null
}

function posInt(v: unknown): number | null {
  const s = posNum(v)
  if (s === null || s.includes('.')) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

function str(v: unknown, max = 120): string | null {
  if (typeof v === 'number') return String(v)
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s.slice(0, max)
}

export type ParsedLine = {
  pos_item_id: string | null
  item_name: string | null
  qty: string | null
  amount: string | null
  tax: string | null
  discount: string | null
}

export type ParsedOrder = {
  pos_order_id: string
  channel: string | null
  order_type: string | null
  payment_mode: string | null
  covers: number | null
  status_raw: string
  status_class: StatusClass
  subtotal: string | null
  discount: string | null
  tax: string | null
  service_charge: string | null
  container: string | null
  round_off: string | null
  order_total: string | null
  lines: ParsedLine[]
}

export type NormalizedPayload = {
  orders: ParsedOrder[]
  apiOrderCount: number
  skippedOtherDates: number
  otherDates: Record<string, number>
  duplicateIds: number
  compDisagreements: number
  note: string | null
}

type RawEntry = { Order?: Record<string, unknown>; OrderItem?: unknown }

/** Filter the two-day payload down to the requested business date and map
 * Petpooja's field names onto the pos_orders / pos_lines columns. */
export function normalizePayload(payload: unknown, businessDate: string): NormalizedPayload {
  const body = payload as { order_json?: unknown }
  if (!body || !Array.isArray(body.order_json)) {
    throw new SalesIngestError('Petpooja payload shape not recognized — expected an order_json array')
  }

  const orders: ParsedOrder[] = []
  const otherDates: Record<string, number> = {}
  const seenIds = new Set<string>()
  let duplicateIds = 0
  let compDisagreements = 0

  for (const entry of body.order_json as RawEntry[]) {
    const o = entry?.Order
    if (!o || typeof o !== 'object') continue
    const orderDate = str(o.order_date, 10)
    const posOrderId = str(o.orderID, 40)
    if (orderDate === null || posOrderId === null) continue
    if (orderDate !== businessDate) {
      // Never assume T+1: the API returns D and D-1 mixed — count, don't bank.
      otherDates[orderDate] = (otherDates[orderDate] ?? 0) + 1
      continue
    }
    if (seenIds.has(posOrderId)) {
      duplicateIds += 1
      continue
    }
    seenIds.add(posOrderId)

    const statusRaw = str(o.status, 60) ?? '(blank)'
    const statusClass = classifyStatus(statusRaw)
    if (/^c/i.test(posOrderId) && statusClass !== 'complimentary') compDisagreements += 1

    const items = Array.isArray(entry.OrderItem) ? (entry.OrderItem as Record<string, unknown>[]) : []
    orders.push({
      pos_order_id: posOrderId,
      channel: str(o.order_from, 60),
      order_type: str(o.order_type, 60),
      payment_mode: str(o.payment_type, 60),
      covers: posInt(o.no_of_persons),
      status_raw: statusRaw,
      status_class: statusClass,
      subtotal: posNum(o.core_total),
      discount: posNum(o.discount_total),
      tax: posNum(o.tax_total),
      service_charge: posNum(o.service_charge),
      container: posNum(o.container_charges),
      round_off: posNum(o.round_off),
      order_total: posNum(o.total),
      lines: items.map((it) => ({
        pos_item_id: str(it.itemid, 40),
        item_name: str(it.name, 200),
        qty: posNum(it.quantity),
        amount: posNum(it.total),
        tax: posNum(it.total_tax),
        discount: posNum(it.total_discount),
      })),
    })
  }

  const skippedOtherDates = Object.values(otherDates).reduce((a, b) => a + b, 0)
  const apiOrderCount = orders.length + skippedOtherDates + duplicateIds

  const noteParts: string[] = []
  if (skippedOtherDates > 0) {
    const detail = Object.entries(otherDates)
      .sort()
      .map(([d, n]) => `${d}×${n}`)
      .join(', ')
    noteParts.push(`skipped ${skippedOtherDates} from other dates (${detail})`)
  }
  if (duplicateIds > 0) noteParts.push(`${duplicateIds} duplicate order id${duplicateIds === 1 ? '' : 's'} skipped`)
  if (compDisagreements > 0) {
    noteParts.push(
      `${compDisagreements} C-prefixed order${compDisagreements === 1 ? '' : 's'} not marked Complimentary — status won`,
    )
  }
  const note = noteParts.length > 0 ? `API returned ${apiOrderCount}; ${noteParts.join('; ')}`.slice(0, 500) : null

  return { orders, apiOrderCount, skippedOtherDates, otherDates, duplicateIds, compDisagreements, note }
}

export type PersistedFetch = {
  fetchId: string
  insertedOrders: number
  insertedLines: number
}

/** Write one fetch: the pos_fetches row, its orders, its lines — one
 * transaction. Latest fetch per date wins at read time; nothing is edited. */
export async function persistFetch(
  restaurantId: string,
  businessDate: string,
  norm: NormalizedPayload,
): Promise<PersistedFetch> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${restaurantId}, 0))`

    const [fetch] = await tx<{ id: string }[]>`
      insert into pos_fetches (restaurant_id, business_date, order_count, note)
      values (${restaurantId}, ${businessDate}, ${norm.orders.length}, ${norm.note})
      returning id`

    let insertedLines = 0
    for (const o of norm.orders) {
      const [order] = await tx<{ id: string }[]>`
        insert into pos_orders (fetch_id, restaurant_id, business_date, pos_order_id,
                                channel, order_type, payment_mode, covers,
                                status_raw, status_class, subtotal, discount, tax,
                                service_charge, container, round_off, order_total)
        values (${fetch.id}, ${restaurantId}, ${businessDate}, ${o.pos_order_id},
                ${o.channel}, ${o.order_type}, ${o.payment_mode}, ${o.covers},
                ${o.status_raw}, ${o.status_class}, ${o.subtotal}, ${o.discount}, ${o.tax},
                ${o.service_charge}, ${o.container}, ${o.round_off}, ${o.order_total})
        returning id`
      if (o.lines.length > 0) {
        const lineRows = o.lines.map((l) => ({
          order_id: order.id,
          pos_item_id: l.pos_item_id,
          item_name: l.item_name,
          qty: l.qty,
          amount: l.amount,
          tax: l.tax,
          discount: l.discount,
        }))
        await tx`insert into pos_lines ${tx(lineRows, 'order_id', 'pos_item_id', 'item_name', 'qty', 'amount', 'tax', 'discount')}`
        insertedLines += lineRows.length
      }
    }

    return { fetchId: fetch.id, insertedOrders: norm.orders.length, insertedLines }
  })
}
