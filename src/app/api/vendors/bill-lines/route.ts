// One bill, as the start of a return: vendor, items and rates in one answer.
//
// Also under /api/vendors — a bill's lines and rates are vendor information.
import { getRestaurant } from '@/server/queries'
import { getBillReturnPrefill } from '@/server/vendor-return-queries'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const purchase = new URL(request.url).searchParams.get('purchase') ?? ''
    const restaurant = await getRestaurant()
    const prefill = await getBillReturnPrefill(restaurant.id, purchase)
    // A voided or reversed bill reads as null — there is nothing left on it
    // to send back, and saying so is better than offering its lines.
    if (prefill === null) return Response.json({ error: 'not returnable' }, { status: 404 })
    return Response.json(prefill)
  } catch (e) {
    console.error('bill return prefill failed', e)
    return Response.json({ error: 'lookup failed' }, { status: 500 })
  }
}
