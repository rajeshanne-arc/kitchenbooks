'use server'
import { z } from 'zod'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
const UUID = /^[0-9a-f-]{36}$/i; const DATE = /^\d{4}-\d{2}-\d{2}$/
export async function reviewPosDifference(raw: { importId: string; businessDate: string; status: 'acknowledged' | 'correction_requested'; note: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try { const input = z.object({ importId: z.string().regex(UUID), businessDate: z.string().regex(DATE), status: z.enum(['acknowledged', 'correction_requested']), note: z.string().trim().min(1).max(300) }).parse(raw); const user = await getSessionUser(); if (!user || !['cashier', 'manager', 'owner', 'accountant'].includes(user.role)) throw new Error('Only an authorized sales or accounts user can review POS differences'); const rid = (await getRestaurant()).id; await txn(async tx => { const [row] = await tx`select id from pos_statement_lines where restaurant_id = ${rid} and import_id = ${input.importId} and business_date = ${input.businessDate}::date limit 1`; if (!row) throw new Error('That provider statement day was not found'); await tx`insert into pos_reconciliation_reviews (restaurant_id, import_id, business_date, status, note, reviewed_by) values (${rid}, ${input.importId}, ${input.businessDate}, ${input.status}, ${input.note}, ${user.username}) on conflict (restaurant_id, import_id, business_date) do update set status = excluded.status, note = excluded.note, reviewed_by = excluded.reviewed_by, reviewed_at = now()` }); return { ok: true } } catch (e) { return { ok: false, error: e instanceof z.ZodError ? 'Add a review note' : e instanceof Error ? e.message : 'Could not save POS review' } }
}
