// Typeahead for the itemized closing and kitchen wastage pickers: raw
// items ∪ sub-recipes ∪ dishes, each hit carrying whether it can be
// costed. The proxy admits chef, manager, owner.
import { NextResponse, type NextRequest } from 'next/server'
import { getRestaurant } from '@/server/queries'
import { searchKitchenComponents } from '@/server/kitchen-queries'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 1) return NextResponse.json([])
  const restaurant = await getRestaurant()
  return NextResponse.json(await searchKitchenComponents(restaurant.id, q.slice(0, 60)))
}
