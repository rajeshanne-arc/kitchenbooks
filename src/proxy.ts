// The minimum door. Salaries live behind this URL now, so the open URL
// expires as acceptable: everything requires the KB_PIN once per device
// (cookie), entered on /pin. This is NOT the roles/login phase — that
// arrives later; this is a single shared PIN from the environment.
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/pin', '/api/pin']

let cached: { pin: string; token: string } | null = null

async function gateToken(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`kitchenbooks-gate:${pin}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next()

  const pin = process.env.KB_PIN
  if (!pin) {
    // fail closed: no PIN configured means nothing is served
    return new NextResponse('KB_PIN is not configured', { status: 503 })
  }
  if (cached === null || cached.pin !== pin) {
    cached = { pin, token: await gateToken(pin) }
  }

  if (request.cookies.get('kb_gate')?.value === cached.token) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'locked — enter the PIN at /pin' }, { status: 401 })
  }
  const url = request.nextUrl.clone()
  url.pathname = '/pin'
  url.search = ''
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
