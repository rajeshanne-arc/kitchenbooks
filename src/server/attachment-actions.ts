'use server'

import { z } from 'zod'
import { tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'

export async function archiveAttachment(raw: { id: string; retentionUntil?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = z.object({ id: z.string().uuid(), retentionUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional() }).parse(raw)
    if (input.retentionUntil) {
      const date = new Date(`${input.retentionUntil}T00:00:00Z`)
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.retentionUntil) throw new Error('Retention date is not a real calendar date')
    }
    const user = await getSessionUser()
    if (!user || !['manager', 'owner'].includes(user.role)) throw new Error('Only a manager or owner can archive evidence')
    const rid = (await getRestaurant()).id
    const [row] = await tsql<{ id: string }[]>`
      update attachments set status = 'archived', retention_until = ${input.retentionUntil || null}::date
      where id = ${input.id} and restaurant_id = ${rid} and status = 'active'
      returning id`
    if (!row) throw new Error('Evidence not found or already archived')
    return { ok: true }
  } catch (e) { return { ok: false, error: e instanceof z.ZodError ? 'Invalid evidence reference' : e instanceof Error ? e.message : 'Could not archive evidence' } }
}
