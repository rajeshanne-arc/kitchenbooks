// Parse + persist for Petpooja payloads. One fetch = ONE pos_fetches row
// plus its orders and lines in a single transaction; a re-fetch is a NEW
// fetch that wins via the latest_fetches view — nothing is ever edited.
//
// STATUS IS A WHITELIST: 'Success' -> revenue, 'Cancelled' -> cancelled,
// 'Complimentary' -> complimentary, ANYTHING ELSE -> unknown — surfaced
// loudly, never banked. C-prefixed order ids are a secondary comp signal;
// status wins, and every disagreement is logged on the fetch row.
import 'server-only'
import { txn } from '@/lib/db'
import type { PayloadCensus, StatusClass } from '@/lib/types'

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
  /** Petpooja's local wall-clock string, anchored to the restaurant's
   *  timezone in SQL. Null when the payload carried no time at all. */
  order_time_local: string | null
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

/**
 * THE PAYLOAD CENSUS — KEY NAMES ONLY, NEVER VALUES.
 *
 * Two questions have been open and unanswerable from this side: does
 * Petpooja send an `itemcode` we could show beside a name, and does it send
 * any of the leakage fields its own dashboard reports — KOT cancellations,
 * bill modifications, re-prints, waivers, a biller identity?
 *
 * We store no raw payload, so a field could be arriving on every fetch and
 * leave no trace. Rather than guess twice, the fetch reports WHAT IT WAS
 * SENT: the set of key names at each level, and a flag for the specific
 * fields we are asking about. One real fetch settles both.
 *
 * ONLY NAMES CROSS THIS BOUNDARY. Values are never read, never logged and
 * never stored — a census of a payload that carries customer names and phone
 * numbers must not become a copy of it.
 *
 * The type lives in lib/types beside FetchDayResult, which carries it back.
 */

/** What a leakage field might be called. Petpooja's naming is unknown, so
 *  this matches on meaning rather than on an exact key we would have to have
 *  guessed right. */
const LEAKAGE_RE = /kot|cancel|modif|reprint|re_print|print_count|waiv|biller|edited|void|discount_by|approved_by/i
const ITEMCODE_RE = /item_?code|short_?code|\bcode\b|sku|alias/i

function censusOf(payload: unknown, orders: Record<string, unknown>[], items: Record<string, unknown>[]): PayloadCensus {
  const top = payload !== null && typeof payload === 'object' ? Object.keys(payload as object) : []
  const union = (rows: Record<string, unknown>[]) => {
    const set = new Set<string>()
    for (const r of rows) for (const k of Object.keys(r)) set.add(k)
    return [...set].sort()
  }
  const orderKeys = union(orders)
  const itemKeys = union(items)
  const all = [...new Set([...top, ...orderKeys, ...itemKeys])]
  return {
    topKeys: top.sort(),
    orderKeys,
    itemKeys,
    candidates: {
      itemCode: itemKeys.filter((k) => ITEMCODE_RE.test(k)).sort(),
      leakage: all.filter((k) => LEAKAGE_RE.test(k)).sort(),
    },
  }
}

export type NormalizedPayload = {
  orders: ParsedOrder[]
  apiOrderCount: number
  skippedOtherDates: number
  otherDates: Record<string, number>
  duplicateIds: number
  /** How many orders arrived with a usable timestamp. */
  withTime: number
  compDisagreements: number
  note: string | null
  /** Key NAMES only — see PayloadCensus. */
  census: PayloadCensus
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
  // Collected for the census: the objects themselves, so their KEYS can be
  // unioned. Nothing reads their values.
  const rawOrders: Record<string, unknown>[] = []
  const rawItems: Record<string, unknown>[] = []
  const otherDates: Record<string, number> = {}
  const seenIds = new Set<string>()
  let duplicateIds = 0
  let compDisagreements = 0
  let withTime = 0

  for (const entry of body.order_json as RawEntry[]) {
    const o = entry?.Order
    if (!o || typeof o !== 'object') continue
    rawOrders.push(o)
    if (Array.isArray(entry.OrderItem)) rawItems.push(...(entry.OrderItem as Record<string, unknown>[]))
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

    // WHEN the order was rung up. Petpooja sends a local wall-clock string
    // with no offset — '2026-08-11 00:30:12' — so it is kept raw here and
    // anchored to the restaurant's timezone in SQL, where that setting already
    // lives. Guessing the offset in JS would put a 00:30 order five and a half
    // hours out, which is precisely the day it does not belong to.
    //
    // Absent is a real answer: the column is nullable, and
    // business_day_disagreements stays empty rather than reporting a
    // comparison it could not make.
    const orderTime =
      str(o.created_on, 40) ?? str(o.order_time, 40) ?? str(o.created_at, 40) ?? null
    if (orderTime !== null) withTime += 1

    const items = Array.isArray(entry.OrderItem) ? (entry.OrderItem as Record<string, unknown>[]) : []
    orders.push({
      pos_order_id: posOrderId,
      order_time_local: orderTime,
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
  // No time on any order is worth saying: it is the reason
  // business_day_disagreements will sit empty, and an empty view with no
  // explanation reads as agreement.
  if (orders.length > 0 && withTime === 0) noteParts.push('no order carried a time — business-day comparison not possible')
  else if (withTime < orders.length) noteParts.push(`${orders.length - withTime} order(s) carried no time`)
  const note = noteParts.length > 0 ? `API returned ${apiOrderCount}; ${noteParts.join('; ')}`.slice(0, 500) : null

  return {
    orders,
    apiOrderCount,
    skippedOtherDates,
    otherDates,
    duplicateIds,
    compDisagreements,
    withTime,
    note,
    census: censusOf(payload, rawOrders, rawItems),
  }
}

export type PersistedFetch = {
  fetchId: string
  insertedOrders: number
  insertedLines: number
  /** Orders of SUPERSEDED generations of this date, removed in the same
   *  transaction. Their lines go with them by cascade. */
  prunedOrders: number
}

/** Write one fetch: the pos_fetches row, its orders, its lines — one
 * transaction. Latest fetch per date wins at read time; nothing is edited. */
export async function persistFetch(
  restaurantId: string,
  businessDate: string,
  norm: NormalizedPayload,
): Promise<PersistedFetch> {
  return txn(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${restaurantId}, 0))`

    const [fetch] = await tx<{ id: string }[]>`
      insert into pos_fetches (restaurant_id, business_date, order_count, note)
      values (${restaurantId}, ${businessDate}, ${norm.orders.length}, ${norm.note})
      returning id`

    let insertedLines = 0
    for (const o of norm.orders) {
      const [order] = await tx<{ id: string }[]>`
        insert into pos_orders (fetch_id, restaurant_id, business_date, pos_order_id,
                                order_time,
                                channel, order_type, payment_mode, covers,
                                status_raw, status_class, subtotal, discount, tax,
                                service_charge, container, round_off, order_total)
        values (${fetch.id}, ${restaurantId}, ${businessDate}, ${o.pos_order_id},
                -- Anchored to the restaurant's timezone, the same setting the
                -- business-day cutover reads. ADDITIVE ONLY: order_time is not
                -- in any key, not in latest_fetches, and not in the in-payload
                -- dedupe (which is pos_order_id alone), so neither which fetch
                -- wins nor how a re-fetch dedupes is affected.
                ${o.order_time_local}::timestamp at time zone coalesce(
                  (select value from settings where key = 'timezone'), 'UTC'),
                ${o.channel}, ${o.order_type}, ${o.payment_mode}, ${o.covers},
                ${o.status_raw}, ${o.status_class}, ${o.subtotal}, ${o.discount}, ${o.tax},
                ${o.service_charge}, ${o.container}, ${o.round_off}, ${o.order_total})
        returning id`
      if (o.lines.length > 0) {
        const lineRows = o.lines.map((l) => ({
          restaurant_id: restaurantId,
          order_id: order.id,
          pos_item_id: l.pos_item_id,
          item_name: l.item_name,
          qty: l.qty,
          amount: l.amount,
          tax: l.tax,
          discount: l.discount,
        }))
        await tx`insert into pos_lines ${tx(lineRows, 'restaurant_id', 'order_id', 'pos_item_id', 'item_name', 'qty', 'amount', 'tax', 'discount')}`
        insertedLines += lineRows.length
      }
    }

    // ── PRUNE THE SUPERSEDED BODIES ──────────────────────────────────
    //
    // WHY THIS DELETE IS LEGITIMATE WHERE THE ONE ON `attendance` IS NOT:
    // pos_orders is a CACHED COPY of somebody else's system. Petpooja holds
    // the truth, a fetch is a photocopy, and a re-fetch takes another one —
    // so a superseded photocopy loses nothing that cannot be fetched again.
    // Every other event table holds something only we hold, which is why they
    // stay append-only and are corrected by reversal.
    //
    // Measured before this existed: a re-fetch re-inserted the fetch row AND
    // every order and line — 71 orders and 334 lines a day, so fifty
    // refreshes in a service left 3,550 orders and 16,700 lines standing in
    // for 71 and 334 of truth.
    //
    // IT KEYS ON THE FETCH ID, NOT ON `fetched_at`. Anything ordering by time
    // would be a second opinion about which generation wins and could
    // disagree with `latest_fetches`; "everything for this date that is not
    // what I just wrote" cannot. It is confined to one restaurant and one
    // date by its own WHERE, and to our own rows by RLS on top of that.
    //
    // LINES GO BY CASCADE — pos_lines_order_id_fkey is ON DELETE CASCADE, so
    // removing orders is sufficient and the ordering is not something anyone
    // can get wrong. EVERY pos_fetches ROW SURVIVES: it is the audit trail
    // and carries the note, and kb_app holds no DELETE on it at all, so that
    // is enforced by grant rather than by discipline.
    const pruned = await tx<{ id: string }[]>`
      delete from pos_orders
      where restaurant_id = ${restaurantId}
        and business_date = ${businessDate}::date
        and fetch_id <> ${fetch.id}
      returning id`

    return {
      fetchId: fetch.id,
      insertedOrders: norm.orders.length,
      insertedLines,
      prunedOrders: pruned.length,
    }
  })
}
