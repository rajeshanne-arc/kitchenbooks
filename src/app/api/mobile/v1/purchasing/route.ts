import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { getPurchaseOrder, listPurchaseOrders } from '@/server/po-queries'
import { listOpenIndents } from '@/server/store-queries'
import { listItems, listVendors } from '@/server/books-queries'

export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const poId = new URL(request.url).searchParams.get('poId')
  if (poId) {
    const order = await getPurchaseOrder(user.restaurantId, poId)
    return order ? NextResponse.json({ order }) : NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
  }
  const [orders, indents, vendors, items] = await Promise.all([listPurchaseOrders(user.restaurantId, true), listOpenIndents(user.restaurantId), listVendors(user.restaurantId, ''), listItems(user.restaurantId, '')])
  return NextResponse.json({ orders, indents, vendors, items })
}
