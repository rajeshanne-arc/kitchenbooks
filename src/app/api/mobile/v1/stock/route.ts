import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { getStockBadge, listStock, stockTotalValue } from '@/server/store-queries'

export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80)
  const [items, badge, totalValue] = await Promise.all([
    listStock(user.restaurantId, q, 'by-value'), getStockBadge(user.restaurantId), stockTotalValue(user.restaurantId),
  ])
  return NextResponse.json({ items: items.slice(0, 100), badge, totalValue })
}
