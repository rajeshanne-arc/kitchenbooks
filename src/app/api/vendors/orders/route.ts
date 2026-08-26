// Orders a delivery from this vendor could be billed against, with their
// lines — so the bill form can prefill what was asked for and the receiver
// types what actually arrived.
//
// Under /api/vendors because a purchase order is vendor information, and gated
// by the same matrix rule as the rest of it.
import { getRestaurant } from '@/server/queries'
import { getPoLinesForBill, listReceivablePos } from '@/server/po-queries'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const vendor = url.searchParams.get('vendor') ?? ''
    const po = url.searchParams.get('po')
    const restaurant = await getRestaurant()
    if (po !== null && po !== '') {
      return Response.json({ lines: await getPoLinesForBill(restaurant.id, po) })
    }
    if (vendor === '') return Response.json({ orders: [] })
    return Response.json({ orders: await listReceivablePos(restaurant.id, vendor) })
  } catch (e) {
    console.error('purchase order lookup failed', e)
    return Response.json({ error: 'lookup failed' }, { status: 500 })
  }
}
