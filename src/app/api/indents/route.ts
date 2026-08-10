// Open indents for the issue form. ?id= returns one indent shaped to
// prefill; ?section= lists that section's open indents (newest first) so
// the form can autofill from the most recent and offer a chooser when
// several are waiting. The proxy admits store, chef, manager, owner.
import { NextResponse, type NextRequest } from 'next/server'
import { getRestaurant } from '@/server/queries'
import { getIndentPrefill, listOpenIndents } from '@/server/store-queries'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  const section = request.nextUrl.searchParams.get('section')
  const restaurant = await getRestaurant()
  if (id !== null) {
    if (!UUID.test(id)) return NextResponse.json({ error: 'malformed id' }, { status: 400 })
    const prefill = await getIndentPrefill(restaurant.id, id)
    if (!prefill) return NextResponse.json({ error: 'indent not found' }, { status: 404 })
    return NextResponse.json(prefill)
  }
  if (section !== null && !UUID.test(section)) {
    return NextResponse.json({ error: 'malformed section' }, { status: 400 })
  }
  return NextResponse.json(await listOpenIndents(restaurant.id, section ?? undefined))
}
