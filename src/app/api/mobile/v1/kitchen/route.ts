import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { listKitchenWastage, listProductions } from '@/server/kitchen-queries'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const [productions, wastage] = await Promise.all([listProductions(user.restaurantId, 40), listKitchenWastage(user.restaurantId, 40)])
  return NextResponse.json({ productions, wastage })
}
