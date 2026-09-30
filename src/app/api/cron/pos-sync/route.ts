import { NextResponse } from 'next/server'
import { tsql } from '@/lib/db'
import { withTenant } from '@/lib/tenant'
import { businessToday } from '@/server/business-day'
import { fetchDay } from '@/server/sales-actions'

export const dynamic = 'force-dynamic'

function authorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET ?? ''
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? request.headers.get('x-cron-secret') ?? ''
  return expected !== '' && supplied === expected
}

/** Hourly POS worker. The database function returns tenant ids only; each
 * fetch then runs inside that tenant's ALS/RLS context. */
export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  const tenants = await tsql<{ restaurant_id: string }[]>`select restaurant_id from list_pos_sync_tenants()`
  const results: { restaurantId: string; date?: string; ok: boolean; error?: string }[] = []
  for (const tenant of tenants) {
    try {
      const date = await withTenant(tenant.restaurant_id, () => businessToday())
      const result = await withTenant(tenant.restaurant_id, () => fetchDay({ date }))
      results.push({ restaurantId: tenant.restaurant_id, date, ok: result.ok, ...(result.ok ? {} : { error: result.error }) })
    } catch (e) {
      results.push({ restaurantId: tenant.restaurant_id, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'sync failed' })
    }
  }
  return NextResponse.json({ processed: results.length, results })
}
