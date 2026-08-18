// Typeahead for the itemized closing and kitchen wastage pickers: raw
// items ∪ sub-recipes ∪ dishes, each hit carrying whether it can be
// costed. The proxy admits chef, manager, owner.
import { NextResponse, type NextRequest } from 'next/server'
import { getRestaurant } from '@/server/queries'
import { searchKitchenComponents } from '@/server/kitchen-queries'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 1) return NextResponse.json([])
  // The department, when the form has one. It scopes and ranks; a malformed or
  // absent id simply means no scope, and RLS makes another tenant's section
  // invisible regardless.
  const section = request.nextUrl.searchParams.get('section') ?? ''
  const restaurant = await getRestaurant()
  return NextResponse.json(
    await searchKitchenComponents(restaurant.id, q.slice(0, 60), UUID.test(section) ? section : null),
  )
}
