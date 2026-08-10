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
    return NextResponse.redirect(url)
  }

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
