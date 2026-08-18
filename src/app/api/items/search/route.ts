import { getRestaurant, searchItems } from '@/server/queries'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').slice(0, 60)
    // The bill's vendor, when one is picked — it scopes and ranks the items and
    // makes the rate prefill that vendor's own. A malformed or absent id simply
    // means no scope; RLS makes another tenant's vendor invisible either way.
    const vendor = url.searchParams.get('vendor') ?? ''
    const restaurant = await getRestaurant()
    return Response.json(await searchItems(restaurant.id, q, UUID.test(vendor) ? vendor : null))
  } catch (e) {
    console.error('item search failed', e)
    return Response.json({ error: 'search failed' }, { status: 500 })
  }
}
