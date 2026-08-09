import { getRestaurant, searchItems } from '@/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 60)
    const restaurant = await getRestaurant()
    return Response.json(await searchItems(restaurant.id, q))
  } catch (e) {
    console.error('item search failed', e)
    return Response.json({ error: 'search failed' }, { status: 500 })
  }
}
