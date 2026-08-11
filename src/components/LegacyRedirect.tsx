import { redirect, permanentRedirect } from 'next/navigation'
import { getSessionUser } from '@/server/current-user'
import { legacyTarget } from '@/lib/legacy'

/** Resolves a retired URL into the caller's group and sends them there for
 *  good. Signed-out callers never reach this — the proxy redirects first. */
export async function goLegacy(path: string): Promise<never> {
  const user = await getSessionUser()
  if (user === null) redirect('/login')
  permanentRedirect(legacyTarget(path, user.role) ?? '/')
}
