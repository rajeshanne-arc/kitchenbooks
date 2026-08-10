import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const gateToken = (pin: string): string =>
  createHash('sha256').update(`kitchenbooks-gate:${pin}`).digest('hex')

export async function POST(request: Request) {
  const origin = new URL(request.url).origin
  const form = await request.formData()
  const attempt = String(form.get('pin') ?? '')
  const expected = process.env.KB_PIN

  const ok =
    expected !== undefined &&
    expected !== '' &&
    attempt.length === expected.length &&
    timingSafeEqual(Buffer.from(attempt), Buffer.from(expected))

  if (!ok) {
    return NextResponse.redirect(new URL('/pin?e=1', origin), 303)
  }

  const res = NextResponse.redirect(new URL('/', origin), 303)
  res.cookies.set('kb_gate', gateToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 90,
    path: '/',
  })
  return res
}
