import { getRestaurant } from '@/server/queries'
import { getClosePrefill } from '@/server/cash-queries'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const date = new URL(request.url).searchParams.get('date') ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: 'bad date' }, { status: 400 })
    }
    const restaurant = await getRestaurant()
    return Response.json(await getClosePrefill(restaurant.id, date))
  } catch (e) {
    console.error('close prefill failed', e)
    return Response.json({ error: 'prefill failed' }, { status: 500 })
  }
}
