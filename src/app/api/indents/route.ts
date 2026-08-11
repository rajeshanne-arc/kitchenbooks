// Open indents for the issue form. ?id= returns one indent shaped to
// prefill; ?section= lists that section's open indents (newest first) so
// the form can autofill from the most recent and offer a chooser when
// several are waiting. The proxy admits store, chef, manager, owner.
import { NextResponse, type NextRequest } from 'next/server'
import { getRestaurant } from '@/server/queries'
import { getIndentPrefill, listOpenIndents } from '@/server/store-queries'
import { getLastIndentFor } from '@/server/kitchen-queries'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  const section = request.nextUrl.searchParams.get('section')
  const session = request.nextUrl.searchParams.get('session')
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
  // ?last=1&section=&session= — the previous request for that department and
  // shift, shaped to prefill. The evening kitchen asks for nearly the same
  // things every evening; retyping it was the biggest daily cost in the app.
  if (request.nextUrl.searchParams.get('last') !== null) {
    if (section === null || session === null) {
      return NextResponse.json({ error: 'section and session required' }, { status: 400 })
    }
    const lastId = await getLastIndentFor(restaurant.id, section, session)
    if (lastId === null) return NextResponse.json({ error: 'no previous request' }, { status: 404 })
    const prefill = await getIndentPrefill(restaurant.id, lastId)
    if (!prefill) return NextResponse.json({ error: 'no previous request' }, { status: 404 })
    return NextResponse.json(prefill)
  }
  return NextResponse.json(
    await listOpenIndents(restaurant.id, section ?? undefined, session ?? undefined),
  )
}
