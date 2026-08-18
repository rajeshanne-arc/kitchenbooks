// What a department usually takes — the top of the issue picker.
//
// Under /api/items rather than a new prefix, so the role gate it inherits is
// the one the matrix already states for item lookups (store, chef, manager,
// owner). A route that invents its own prefix invents its own gate.
import { getRestaurant } from '@/server/queries'
import { getSectionFrequentItems } from '@/server/store-queries'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  try {
    const section = new URL(request.url).searchParams.get('section') ?? ''
    // A malformed id is an empty suggestion list, not a 500: this is a
    // courtesy on top of a working form, and it must never break the form.
    if (!UUID.test(section)) return Response.json([])
    const restaurant = await getRestaurant()
    return Response.json(await getSectionFrequentItems(restaurant.id, section))
  } catch (e) {
    console.error('frequent item lookup failed', e)
    return Response.json([])
  }
}
