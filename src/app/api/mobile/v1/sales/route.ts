import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { businessToday } from '@/server/business-day'
import { getClosePrefill, getLadderDay } from '@/server/cash-queries'
import { listSettlements, listDues } from '@/server/cashier-queries'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const date = await businessToday()
  const [prefill, ladder, settlements, dues] = await Promise.all([
    getClosePrefill(user.restaurantId, date), getLadderDay(user.restaurantId, date), listSettlements(user.restaurantId, 20), listDues(user.restaurantId, 20),
  ])
  return NextResponse.json({ date, prefill, ladder, settlements, dues })
}
