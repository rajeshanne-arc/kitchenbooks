import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDaySheet } from '@/server/labour-queries'
import { saveAttendance } from '@/server/labour-actions'
import { getSessionUser } from '@/server/current-user'
import { businessToday } from '@/server/business-day'
import { finishMobileMutation, reserveMobileMutation } from '@/server/mobile-mutations'

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const requestedDate = new URL(request.url).searchParams.get('date')
  const date = DateSchema.safeParse(requestedDate ?? await businessToday())
  if (!date.success) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  const sheet = await getDaySheet(user.restaurantId, date.data)
  return NextResponse.json({ date: date.data, sheet })
}

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  try {
    const body = await request.json() as { clientMutationId?: string; date?: string; marks?: unknown }
    if (!body.clientMutationId || !/^[a-zA-Z0-9_-]{12,120}$/.test(body.clientMutationId)) {
      return NextResponse.json({ error: 'clientMutationId is required for safe retry' }, { status: 400 })
    }
    const payload = { date: body.date, marks: body.marks }
    const reservation = await reserveMobileMutation({ restaurantId: user.restaurantId, clientMutationId: body.clientMutationId, operation: 'attendance.save', request: payload, enteredBy: user.username })
    if (reservation.kind === 'replay') return NextResponse.json({ ...(reservation.response as object), replayed: true })
    if (reservation.kind === 'processing') return NextResponse.json({ error: 'This save is already being processed — retry shortly' }, { status: 409 })
    const result = await saveAttendance(payload as Parameters<typeof saveAttendance>[0])
    await finishMobileMutation(reservation.id, result.ok ? 'accepted' : 'failed', result)
    if (!result.ok) return NextResponse.json(result, { status: 400 })
    return NextResponse.json(result)
  } catch (error) {
    console.error('mobile attendance failed', error)
    return NextResponse.json({ error: 'Unable to save attendance' }, { status: 500 })
  }
}
