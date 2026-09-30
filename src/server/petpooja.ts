// The Petpooja Get Orders adapter — the ONLY place the POS API is spoken to.
// Credentials are supplied by the active tenant's encrypted credential row;
// values never appear in code, the repo, the browser, or a transcript.
//
// Hard-won API facts, each from a real bug:
//   - Get Orders returns TWO days of orders (D and D-1) regardless of the
//     requested date — callers must filter on order_date == business_date.
//   - Order IDs restart daily; the only stable key is (order_date, orderID).
import 'server-only'

const ENDPOINT = 'https://api.petpooja.com/V1/thirdparty/generic_get_orders/'

export class PetpoojaError extends Error {}

type PetpoojaOrdersResponse = {
  code?: unknown
  success?: unknown
  message?: unknown
  order_json: unknown[]
}

/** Validate the provider envelope before handing it to the generic normalizer.
 * The normalizer may tolerate missing order fields because those are source
 * facts to surface, but a response without the documented order collection is
 * not an empty sales day — it is a provider-contract failure. */
export function assertPetpoojaOrdersResponse(value: unknown): asserts value is PetpoojaOrdersResponse {
  if (value === null || typeof value !== 'object' || !Array.isArray((value as { order_json?: unknown }).order_json)) {
    throw new PetpoojaError('Petpooja response shape changed — expected an order_json array; nothing was fetched')
  }
}

/**
 * Local demo payload for exploring the sales workflow before Petpooja access
 * is available. It deliberately uses the same response shape as Get Orders;
 * everything after this adapter still exercises the real normalizer and
 * persistence path.
 *
 * This is development-only by construction. Never enable it in a deployed
 * environment: demo orders must never be mixed with real sales.
 */
function demoPayload(businessDate: string): unknown {
  const previous = new Date(`${businessDate}T00:00:00Z`)
  previous.setUTCDate(previous.getUTCDate() - 1)
  const previousDate = previous.toISOString().slice(0, 10)
  const order = (input: {
    id: string
    date: string
    status: string
    payment: string
    total: string
    covers: string
    time: string
    items: { id: string; name: string; qty: string; total: string }[]
  }) => ({
    Restaurant: { restID: 'demo' },
    Customer: {},
    Order: {
      orderID: input.id,
      order_date: input.date,
      status: input.status,
      order_type: 'Dine In',
      payment_type: input.payment,
      order_from: 'POS',
      no_of_persons: input.covers,
      created_on: `${input.date} ${input.time}`,
      core_total: input.total,
      discount_total: '0',
      tax_total: '0',
      service_charge: '0',
      container_charges: '0',
      round_off: '0',
      total: input.total,
    },
    Tax: [],
    Discount: [],
    OrderItem: input.items.map((item) => ({
      itemid: item.id,
      name: item.name,
      quantity: item.qty,
      price: item.total,
      total: item.total,
      total_tax: '0',
      total_discount: '0',
    })),
  })

  return {
    code: '200',
    success: '1',
    message: 'KitchenBooks local demo data',
    order_json: [
      order({
        id: 'DEMO-1001', date: businessDate, status: 'Success', payment: 'Cash', total: '1000', covers: '4', time: '12:30:00',
        items: [
          { id: 'DEMO-PANEER', name: 'Paneer Tikka', qty: '2', total: '700' },
          { id: 'DEMO-DAL', name: 'Dal Tadka', qty: '1', total: '300' },
        ],
      }),
      order({
        id: 'DEMO-1002', date: businessDate, status: 'Success', payment: 'UPI', total: '850', covers: '3', time: '19:45:00',
        items: [{ id: 'DEMO-BIRYANI', name: 'Chicken Biryani', qty: '2', total: '850' }],
      }),
      order({
        id: 'DEMO-1003', date: businessDate, status: 'Complimentary', payment: 'Cash', total: '350', covers: '2', time: '20:10:00',
        items: [{ id: 'DEMO-PANEER', name: 'Paneer Tikka', qty: '1', total: '350' }],
      }),
      order({
        id: 'DEMO-1004', date: businessDate, status: 'Cancelled', payment: 'Cash', total: '200', covers: '1', time: '21:05:00',
        items: [{ id: 'DEMO-SOUP', name: 'Tomato Soup', qty: '1', total: '200' }],
      }),
      order({
        id: 'DEMO-1005', date: businessDate, status: 'Held', payment: 'Cash', total: '150', covers: '1', time: '21:20:00',
        items: [{ id: 'DEMO-UNKNOWN', name: 'Demo Unknown Item', qty: '1', total: '150' }],
      }),
      // The real Petpooja endpoint returns the requested day and the previous
      // day together. Keeping one previous-day row makes that production rule
      // visible in the local demo too.
      order({
        id: 'DEMO-PREV', date: previousDate, status: 'Success', payment: 'Cash', total: '492', covers: '2', time: '22:00:00',
        items: [{ id: 'DEMO-PREV-ITEM', name: 'Previous Day Demo', qty: '1', total: '492' }],
      }),
    ],
  }
}

/** Raw Get Orders call for one business date. Returns the parsed JSON
 * payload; the ingest layer filters and classifies — this function only
 * speaks HTTP and refuses unconfigured environments loudly. */
export async function fetchPetpoojaOrders(
  businessDate: string,
  credentials?: { appKey: string; appSecret: string; accessToken: string; restaurantId: string },
): Promise<unknown> {
  if (process.env.NODE_ENV !== 'production' && process.env.PETPOOJA_DEMO === 'true') {
    return demoPayload(businessDate)
  }
  const PP_APP_KEY = credentials?.appKey
  const PP_APP_SECRET = credentials?.appSecret
  const PP_ACCESS_TOKEN = credentials?.accessToken
  const PP_REST_ID = credentials?.restaurantId
  if (!PP_APP_KEY || !PP_APP_SECRET || !PP_ACCESS_TOKEN || !PP_REST_ID) {
    throw new PetpoojaError(
      'Petpooja credentials are not configured for this restaurant — an owner must save them in Settings',
    )
  }
  let res: Response | null = null
  let lastNetworkError = 'network error'
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_key: PP_APP_KEY,
          app_secret: PP_APP_SECRET,
          access_token: PP_ACCESS_TOKEN,
          restID: PP_REST_ID,
          order_date: businessDate,
          refId: '',
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      })
      if (res.ok || (res.status < 500 && res.status !== 429)) break
    } catch (e) {
      lastNetworkError = e instanceof Error ? e.message.slice(0, 120) : 'network error'
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 500 : 1500))
  }
  if (res === null) throw new PetpoojaError(`Could not reach Petpooja after 3 attempts — nothing was fetched. (${lastNetworkError})`)
  if (!res.ok) throw new PetpoojaError(`Petpooja returned HTTP ${res.status} after 3 attempts — nothing was fetched`)
  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new PetpoojaError('Petpooja returned a non-JSON response — nothing was fetched')
  }
  assertPetpoojaOrdersResponse(data)
  if (String(data?.success) !== '1') {
    const msg = typeof data?.message === 'string' && data.message !== '' ? ` — ${data.message.slice(0, 160)}` : ''
    throw new PetpoojaError(`Petpooja refused the request (code ${String(data?.code ?? '?')})${msg}`)
  }
  return data
}
