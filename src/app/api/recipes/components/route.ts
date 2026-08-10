import { getRestaurant } from '@/server/queries'
import { searchComponents } from '@/server/recipes-queries'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').slice(0, 60)
    const exclude = url.searchParams.get('exclude')
    const restaurant = await getRestaurant()
    return Response.json(
      await searchComponents(restaurant.id, q, exclude !== null && UUID.test(exclude) ? exclude : null),
    )
  } catch (e) {
    console.error('component search failed', e)
    return Response.json({ error: 'search failed' }, { status: 500 })
  }
}
