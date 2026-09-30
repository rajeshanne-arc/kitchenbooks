import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { attachPhoto } from '@/server/attachments-actions'

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const result = await attachPhoto(await request.formData() as unknown as FormData)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
