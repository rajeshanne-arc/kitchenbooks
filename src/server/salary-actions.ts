'use server'

import { z } from 'zod'
import { tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
class SalaryError extends Error {}
function realDate(s: string) { const d = new Date(`${s}T00:00:00Z`); if (!DATE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new SalaryError('Effective date is not a real calendar date') }
export async function saveSalaryStructure(raw: { staffId: string; effectiveFrom: string; baseSalary: string; note: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = z.object({ staffId: z.string().regex(UUID), effectiveFrom: z.string().regex(DATE), baseSalary: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/), note: z.string().trim().max(300) }).parse(raw)
    realDate(input.effectiveFrom); if (Number(input.baseSalary) <= 0) throw new SalaryError('Base salary must be more than zero')
    const user = await getSessionUser(); if (!user || !['accountant', 'owner'].includes(user.role)) throw new SalaryError('Only an accountant or owner can set salary structures')
    const rid = (await getRestaurant()).id
    const [staff] = await tsql<{ id: string }[]>`select id from staff where id = ${input.staffId} and restaurant_id = ${rid} and status = 'active'`
    if (!staff) throw new SalaryError('That staff member is not active in this restaurant')
    await tsql`insert into salary_structures (restaurant_id, staff_id, effective_from, base_salary, note, entered_by) values (${rid}, ${input.staffId}, ${input.effectiveFrom}::date, ${input.baseSalary}::numeric, ${input.note === '' ? null : input.note}, ${user.username})`
    return { ok: true }
  } catch (e) { return { ok: false, error: e instanceof SalaryError ? e.message : e instanceof z.ZodError ? 'Invalid salary structure — nothing was saved' : 'That effective date already has a salary structure or the save failed' } }
}
