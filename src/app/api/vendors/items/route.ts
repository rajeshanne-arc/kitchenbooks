// What a vendor has supplied, with the rate their last bill charged.
//
// Under /api/vendors, NOT /api/items, and the difference is LAW 1. The item
// prefix admits the chef; who supplies what is vendor information, and the
// chef has no vendor access anywhere in the matrix. The prefix carries the
// gate, so the route needs no role check of its own.
import { getRestaurant } from '@/server/queries'
import { getVendorSuppliedItems } from '@/server/vendor-return-queries'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const vendor = new URL(request.url).searchParams.get('vendor') ?? ''
    const restaurant = await getRestaurant()
    // getVendorSuppliedItems answers [] on a malformed id — a suggestion
    // list that fails must degrade to no suggestions, never to an error.
    return Response.json(await getVendorSuppliedItems(restaurant.id, vendor))
  } catch (e) {
    console.error('vendor supplied item lookup failed', e)
    return Response.json([])
  }
}
