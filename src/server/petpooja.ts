// The Petpooja Get Orders adapter — the ONLY place the POS API is spoken to.
// Credentials live in the environment (PP_APP_KEY / PP_APP_SECRET /
// PP_ACCESS_TOKEN / PP_REST_ID — the same values as the Sales sheet's Script
// Properties); values never appear in code, the repo, or a transcript.
//
// Hard-won API facts, each from a real bug:
//   - Get Orders returns TWO days of orders (D and D-1) regardless of the
//     requested date — callers must filter on order_date == business_date.
//   - Order IDs restart daily; the only stable key is (order_date, orderID).
import 'server-only'

const ENDPOINT = 'https://api.petpooja.com/V1/thirdparty/generic_get_orders/'

export class PetpoojaError extends Error {}

/** Raw Get Orders call for one business date. Returns the parsed JSON
 * payload; the ingest layer filters and classifies — this function only
 * speaks HTTP and refuses unconfigured environments loudly. */
export async function fetchPetpoojaOrders(businessDate: string): Promise<unknown> {
  const { PP_APP_KEY, PP_APP_SECRET, PP_ACCESS_TOKEN, PP_REST_ID } = process.env
  if (!PP_APP_KEY || !PP_APP_SECRET || !PP_ACCESS_TOKEN || !PP_REST_ID) {
    throw new PetpoojaError(
      'Petpooja credentials are not configured — set PP_APP_KEY, PP_APP_SECRET, PP_ACCESS_TOKEN and PP_REST_ID in the environment',
    )
  }
  let res: Response
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
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 120) : 'network error'
    throw new PetpoojaError(`Could not reach Petpooja — nothing was fetched. (${detail})`)
  }
  if (!res.ok) throw new PetpoojaError(`Petpooja returned HTTP ${res.status} — nothing was fetched`)
  let data: { code?: unknown; success?: unknown; message?: unknown }
  try {
    data = (await res.json()) as typeof data
  } catch {
    throw new PetpoojaError('Petpooja returned a non-JSON response — nothing was fetched')
  }
  if (String(data?.success) !== '1') {
    const msg = typeof data?.message === 'string' && data.message !== '' ? ` — ${data.message.slice(0, 160)}` : ''
    throw new PetpoojaError(`Petpooja refused the request (code ${String(data?.code ?? '?')})${msg}`)
  }
  return data
}
