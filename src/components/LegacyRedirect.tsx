import { redirect, permanentRedirect } from 'next/navigation'
import { getSessionUser } from '@/server/current-user'
import { legacyTarget } from '@/lib/legacy'

/** Resolves a retired URL into the caller's group and sends them there for
 *  good. Signed-out callers never reach this — the proxy redirects first.
 *
 *  The QUERY STRING travels with them. Phones have `/issue?indent=<id>`
 *  bookmarked and WhatsApp threads are full of such links; dropping the
 *  search params landed the caller on a blank form and looked exactly like
 *  a broken prefill. Callers pass their own searchParams through. */
export async function goLegacy(
  path: string,
  searchParams?: Record<string, string | string[] | undefined>,
): Promise<never> {
  const user = await getSessionUser()
  if (user === null) redirect('/login')
  const target = legacyTarget(path, user.role) ?? '/'
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (typeof v === 'string') qs.append(k, v)
    else if (Array.isArray(v)) for (const one of v) qs.append(k, one)
  }
  const query = qs.toString()
  permanentRedirect(query === '' ? target : `${target}?${query}`)
}
