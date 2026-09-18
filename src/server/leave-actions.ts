'use server'

import { z } from 'zod'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DAYS = /^\d{1,3}(\.\d{1,2})?$/
class LeaveError extends Error {}

async function manager() {
  const user = await getSessionUser()
  if (!user || !['manager', 'owner'].includes(user.role)) throw new LeaveError('Only a manager or owner can maintain leave policies')
  return user.username
}

/** @scope now */
export async function saveLeavePolicy(raw: { id?: string; code: string; name: string; annualDays: string; paidDays: string; carryForward: boolean; status: 'active' | 'inactive' }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = z.object({ id: z.union([z.literal(''), z.string().regex(UUID)]).optional(), code: z.string().trim().regex(/^[A-Za-z0-9_-]{1,20}$/), name: z.string().trim().min(1).max(100), annualDays: z.string().regex(DAYS), paidDays: z.string().regex(DAYS), carryForward: z.boolean(), status: z.enum(['active', 'inactive']) }).parse(raw)
    const by = await manager(); const annual = Number(input.annualDays); const paid = Number(input.paidDays)
    if (paid > annual) throw new LeaveError('Paid leave cannot exceed the annual leave allowance')
    const rid = (await getRestaurant()).id
    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      if (input.id) {
        const [row] = await tx<{ id: string }[]>`update leave_policies set code = ${input.code.toUpperCase()}, name = ${input.name}, annual_days = ${input.annualDays}, paid_days = ${input.paidDays}, carry_forward = ${input.carryForward}, status = ${input.status} where id = ${input.id} and restaurant_id = ${rid} returning id`
        if (!row) throw new LeaveError('Leave policy not found')
      } else {
        await tx`insert into leave_policies (restaurant_id, code, name, annual_days, paid_days, carry_forward, status, entered_by) values (${rid}, ${input.code.toUpperCase()}, ${input.name}, ${input.annualDays}, ${input.paidDays}, ${input.carryForward}, ${input.status}, ${by})`
      }
    })
    return { ok: true }
  } catch (e) { return { ok: false, error: e instanceof z.ZodError ? 'Check the leave policy fields' : e instanceof Error ? e.message : 'Could not save leave policy' } }
}

/** @scope now */
export async function assignLeavePolicy(raw: { staffId: string; policyId: string; effectiveFrom: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = z.object({ staffId: z.string().regex(UUID), policyId: z.string().regex(UUID), effectiveFrom: z.string().regex(DATE) }).parse(raw)
    const by = await manager(); const rid = (await getRestaurant()).id
    const d = new Date(`${input.effectiveFrom}T00:00:00Z`)
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.effectiveFrom) throw new LeaveError('Effective date is not a real calendar date')
    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [staff] = await tx<{ id: string }[]>`select id from staff where restaurant_id = ${rid} and id = ${input.staffId} and status = 'active'`
      const [policy] = await tx<{ id: string }[]>`select id from leave_policies where restaurant_id = ${rid} and id = ${input.policyId} and status = 'active'`
      if (!staff || !policy) throw new LeaveError('Choose an active staff member and active leave policy')
      const [current] = await tx<{ effective_from: string }[]>`select effective_from::text as effective_from from staff_leave_policy_assignments where restaurant_id = ${rid} and staff_id = ${input.staffId} and effective_to is null`
      if (current && input.effectiveFrom <= current.effective_from) throw new LeaveError(`The new effective date must be after the current assignment (${current.effective_from})`)
      await tx`update staff_leave_policy_assignments set effective_to = ${input.effectiveFrom}::date - 1 where restaurant_id = ${rid} and staff_id = ${input.staffId} and effective_to is null`
      await tx`insert into staff_leave_policy_assignments (restaurant_id, staff_id, policy_id, effective_from, entered_by) values (${rid}, ${input.staffId}, ${input.policyId}, ${input.effectiveFrom}::date, ${by})`
    })
    return { ok: true }
  } catch (e) { return { ok: false, error: e instanceof z.ZodError ? 'Choose a staff member, policy, and date' : e instanceof Error ? e.message : 'Could not assign leave policy' } }
}
