import { NextRequest, NextResponse } from 'next/server'
import { provisionRestaurant } from '@/server/provisioning'

export async function POST(request: NextRequest) {
  const key = request.headers.get('x-kb-platform-key') ?? undefined
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be JSON' }, { status: 400 })
  }
  const result = await provisionRestaurant(key, body)
  return NextResponse.json(result, { status: result.ok ? 201 : result.error === 'Platform authorization failed' ? 401 : 400 })
}
