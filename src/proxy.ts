// The door, with names on keys now. The shared-PIN era is over: every
// request needs a valid signed session cookie, and the role in it must be
// allowed the path (src/lib/roles.ts is the matrix; actions re-check
// against the database). Fail closed: no secret configured means nothing
// is served. /setup is public but creates only the FIRST owner, gated by
// the bootstrap code — after that it refuses forever.
import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/session'
import { canAccess, type Role, ALL_ROLES } from '@/lib/roles'

const PUBLIC_PATHS = ['/login', '/setup', '/manifest.webmanifest', '/icon.svg', '/apple-icon.svg']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next()

  const secret = process.env.KB_SESSION_SECRET
  if (!secret) {
    // fail closed: no secret configured means nothing is served
    return new NextResponse('KB_SESSION_SECRET is not configured', { status: 503 })
  }

  const payload = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret)
  if (!payload || !ALL_ROLES.includes(payload.r as Role)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'not signed in' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`
    const res = NextResponse.redirect(url)
    // CLEAR THE COOKIE ON THE WAY OUT. A token that did not verify is not a
    // session, and leaving it in the jar means the browser presents it again
    // on every request for the next thirty days. That is how one stale cookie
    // — a v1 token from before the tenant claim existed — followed Rajesh
    // from page to page. An unrecognised session must end as a sign-out.
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  }

  // THE DENIAL PAGE IS REACHABLE BY EVERY SIGNED-IN ROLE, and it has to be.
  //
  // `/denied` is not in the matrix, and the matrix fails closed on unknown
  // paths — correctly. But this proxy REDIRECTS here on denial, so the page
  // denied itself: /denied -> canAccess false -> redirect to /denied -> …
  // Every genuine permission denial was ERR_TOO_MANY_REDIRECTS rather than
  // the sentence naming who to ask, which is LAW 1's whole point.
  //
  // It is admitted after the session check, not added to PUBLIC_PATHS: signed
  // out still means go and sign in. A destination this proxy can send someone
  // to must be a destination it will let them arrive at.
  if (pathname === '/denied') return NextResponse.next()

  if (!canAccess(payload.r as Role, pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'your role cannot use this' }, { status: 403 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/denied'
    url.search = `?path=${encodeURIComponent(pathname)}`
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
