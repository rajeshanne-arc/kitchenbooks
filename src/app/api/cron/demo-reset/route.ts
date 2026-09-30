import { NextResponse } from 'next/server'
import { tsql } from '@/lib/db'

export const dynamic = 'force-dynamic'

function authorised(request: Request): boolean {
  const expected = process.env.KB_DEMO_RESET_SECRET ?? ''
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? request.headers.get('x-demo-reset-secret') ?? ''
  return expected !== '' && supplied === expected
}

async function reset(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  const tenant = process.env.KB_DEMO_TENANT_ID ?? ''
  const owner = process.env.KB_DEMO_OWNER_USERNAME ?? 'sunny'
  if (!tenant) return NextResponse.json({ error: 'demo reset is not configured' }, { status: 503 })
  try {
    await tsql`select reset_demo_tenant(${tenant}::uuid, ${owner})`
    await tsql`select seed_demo_tenant(${tenant}::uuid, ${owner})`
    return NextResponse.json({ ok: true, tenant, resetAt: new Date().toISOString() })
  } catch (error) {
    console.error('demo tenant reset failed', error)
    return NextResponse.json({ error: 'demo reset failed' }, { status: 500 })
  }
}

export async function GET(request: Request) { return reset(request) }
export async function POST(request: Request) { return reset(request) }
