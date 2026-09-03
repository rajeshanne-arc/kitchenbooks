// READS GO THROUGH OUR OWN ROUTE, never a raw storage URL.
//
//   session -> role -> row (RLS-scoped) -> PREFIX CHECK -> stream
//
// That way the role matrix governs a bill photo exactly as it governs every
// other surface and LAW 1 acquires no exception. A public or long-lived
// storage URL would be a door with no session behind it — the one thing this
// route exists to prevent.
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import { readAttachment, AttachmentRefusal } from '@/server/attachments-queries'
import { getObject, BlobUnconfigured, BlobNotFound } from '@/server/blob'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser()
    if (!user) return new Response('Sign in', { status: 401 })
    if (!canAccess(user.role, '/api/attachments')) return new Response('Not yours to open', { status: 403 })

    const { id } = await params
    const restaurant = await getRestaurant()
    const row = await readAttachment(restaurant.id, id)
    const { body, contentType } = await getObject(row.storage_key)

    return new Response(body, {
      headers: {
        'content-type': contentType,
        // PRIVATE, and never a shared cache: this is one restaurant's paper.
        'cache-control': 'private, max-age=60',
        'content-disposition': `inline; filename="${(row.filename ?? 'bill').replace(/[^\w.-]/g, '_')}"`,
      },
    })
  } catch (e) {
    if (e instanceof AttachmentRefusal) return new Response(e.message, { status: 404 })
    if (e instanceof BlobNotFound) return new Response(e.message, { status: 404 })
    if (e instanceof BlobUnconfigured) return new Response(e.message, { status: 503 })
    console.error('attachment read failed', e)
    return new Response('Could not read that file', { status: 500 })
  }
}
