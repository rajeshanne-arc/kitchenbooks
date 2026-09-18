'use server'

import { z } from 'zod'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'

const UUID = /^[0-9a-f-]{36}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
export async function reviewProductionVariance(raw: { recipeId: string; monthStart: string; status: 'acknowledged' | 'correction_requested'; note: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = z.object({ recipeId: z.string().regex(UUID), monthStart: z.string().regex(DATE), status: z.enum(['acknowledged', 'correction_requested']), note: z.string().trim().min(1).max(300) }).parse(raw)
    const user = await getSessionUser()
    if (!user || !['manager', 'owner'].includes(user.role)) throw new Error('Only a manager or owner can review production variance')
    const rid = (await getRestaurant()).id
    await txn(async (tx) => {
      const [variance] = await tx`select recipe_id from productions where restaurant_id = ${rid} and recipe_id = ${input.recipeId} and prod_date >= ${input.monthStart}::date and prod_date < (${input.monthStart}::date + interval '1 month') and expected_output_qty is not null limit 1`
      if (!variance) throw new Error('No production variance exists for that recipe and month')
      await tx`insert into production_variance_reviews (restaurant_id, recipe_id, month_start, status, note, reviewed_by, reviewed_at) values (${rid}, ${input.recipeId}, ${input.monthStart}, ${input.status}, ${input.note}, ${user.username}, now()) on conflict (restaurant_id, recipe_id, month_start) do update set status = excluded.status, note = excluded.note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at`
    })
    return { ok: true }
  } catch (e) { return { ok: false, error: e instanceof z.ZodError ? 'Check the variance review fields' : e instanceof Error ? e.message : 'Could not save variance review' } }
}
