'use server'

import { z } from 'zod'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
class LeaveRequestError extends Error {}
const result = (e: unknown) => ({ ok: false as const, error: e instanceof z.ZodError ? 'Check the leave request fields' : e instanceof Error ? e.message : 'Leave request failed' })

async function actor(allowed: string[]) {
  const user = await getSessionUser()
  if (!user || !allowed.includes(user.role)) throw new LeaveRequestError('This leave action is not available to your role')
  return user.username
}

function dates(from: string, to: string) {
  const out: string[] = []; const d = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`)
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

/** Record the accountant's year-end carry-forward decision. The value is
 * bounded by the source year's explicit policy and approved leave; the ledger
 * itself is insert-only so a later correction cannot rewrite prior evidence. */
/** @scope all-time */
export async function recordLeaveCarryForward(raw: { staffId: string; sourceYear: number; carriedDays: string; note: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const input = z.object({ staffId: z.string().regex(UUID), sourceYear: z.number().int().min(2000).max(2200), carriedDays: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/), note: z.string().trim().max(300) }).parse(raw)
    const by = await actor(['accountant', 'owner']); const rid = (await getRestaurant()).id
    return await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:leave:' || ${rid}, 0))`
      const [staff] = await tx`select id from staff where restaurant_id = ${rid} and id = ${input.staffId} and status = 'active'`
      if (!staff) throw new LeaveRequestError('Choose an active staff member')
      const [policy] = await tx<{ annual_days: string; carry_forward: boolean }[]>`select p.annual_days::text, p.carry_forward
        from staff_leave_policy_assignments a join leave_policies p on p.restaurant_id = a.restaurant_id and p.id = a.policy_id
        where a.restaurant_id = ${rid} and a.staff_id = ${input.staffId} and p.status = 'active'
          and a.effective_from <= make_date(${input.sourceYear}, 12, 31)
          and (a.effective_to is null or a.effective_to >= make_date(${input.sourceYear}, 1, 1))
        order by a.effective_from desc limit 1`
      const [{ used }] = await tx<{ used: string }[]>`select coalesce(sum(requested_days), 0)::text as used from leave_requests
        where restaurant_id = ${rid} and staff_id = ${input.staffId} and status = 'approved'
          and start_date < make_date(${input.sourceYear + 1}, 1, 1) and end_date >= make_date(${input.sourceYear}, 1, 1)`
      const maximum = policy?.carry_forward ? Math.max(Number(policy.annual_days) - Number(used), 0) : 0
      if (Number(input.carriedDays) > maximum) throw new LeaveRequestError(`Carry-forward cannot exceed ${maximum.toFixed(2)} days for ${input.sourceYear}`)
      const [row] = await tx<{ id: string }[]>`insert into leave_carry_forward_ledger
        (restaurant_id, staff_id, source_year, target_year, carried_days, note, entered_by)
        values (${rid}, ${input.staffId}, ${input.sourceYear}, ${input.sourceYear + 1}, ${input.carriedDays}::numeric, ${input.note.trim() || null}, ${by})
        returning id`
      return { ok: true as const, id: row.id }
    })
  } catch (e) { return result(e) }
}

/** @scope all-time */
export async function createLeaveRequest(raw: { staffId: string; policyId: string; startDate: string; endDate: string; note: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const input = z.object({ staffId: z.string().regex(UUID), policyId: z.string().regex(UUID), startDate: z.string().regex(DATE), endDate: z.string().regex(DATE), note: z.string().trim().max(300) }).parse(raw)
    const by = await actor(['manager', 'owner']); const rid = (await getRestaurant()).id
    const ds = dates(input.startDate, input.endDate)
    if (ds.length === 0 || ds.length > 366) throw new LeaveRequestError('Choose a valid leave period')
    if (input.startDate.slice(0, 4) !== input.endDate.slice(0, 4)) throw new LeaveRequestError('Leave requests must stay within one calendar year so the balance is unambiguous')
    return await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:leave:' || ${rid}, 0))`
      const [staff] = await tx`select id from staff where restaurant_id = ${rid} and id = ${input.staffId} and status = 'active'`
      const [policy] = await tx<{ id: string; annual_days: string }[]>`select id, annual_days::text from leave_policies where restaurant_id = ${rid} and id = ${input.policyId} and status = 'active'`
      if (!staff || !policy) throw new LeaveRequestError('Choose an active staff member and policy')
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from leave_requests where restaurant_id = ${rid} and staff_id = ${input.staffId} and status in ('pending', 'approved') and start_date <= ${input.endDate}::date and end_date >= ${input.startDate}::date`
      if (n > 0) throw new LeaveRequestError('This person already has an overlapping pending or approved leave')
      const year = Number(input.startDate.slice(0, 4))
      const [{ used }] = await tx<{ used: string }[]>`select coalesce(sum(r.requested_days), 0)::text as used from leave_requests r where r.restaurant_id = ${rid} and r.staff_id = ${input.staffId} and r.status in ('pending', 'approved') and r.start_date < make_date(${year + 1}, 1, 1) and r.end_date >= make_date(${year}, 1, 1)`
      const [carry] = await tx<{ carry: string }[]>`select coalesce(cf.carried_days, case when p.carry_forward then greatest(coalesce(prev.annual_days, 0) - coalesce(prev_used.days, 0), 0) else 0 end)::text as carry
        from leave_policies p
        left join lateral (select annual_days from leave_policies where restaurant_id = ${rid} and id = p.id) prev on true
        left join lateral (select sum(requested_days) as days from leave_requests where restaurant_id = ${rid} and staff_id = ${input.staffId} and status = 'approved' and start_date < make_date(${year}, 1, 1) and end_date >= make_date(${year - 1}, 1, 1)) prev_used on true
        left join leave_carry_forward_ledger cf on cf.restaurant_id = ${rid} and cf.staff_id = ${input.staffId} and cf.source_year = ${year - 1} and cf.target_year = ${year}
        where p.restaurant_id = ${rid} and p.id = ${input.policyId}`
      if (Number(used) + ds.length > Number(policy.annual_days) + Number(carry?.carry ?? 0)) throw new LeaveRequestError(`This request exceeds the available allowance of ${Number(policy.annual_days) + Number(carry?.carry ?? 0)} days`)
      const [row] = await tx<{ id: string }[]>`insert into leave_requests (restaurant_id, staff_id, policy_id, start_date, end_date, requested_days, note, requested_by) values (${rid}, ${input.staffId}, ${input.policyId}, ${input.startDate}, ${input.endDate}, ${ds.length}, ${input.note || null}, ${by}) returning id`
      return { ok: true as const, id: row.id }
    })
  } catch (e) { return result(e) }
}

/** @scope all-time */
export async function decideLeaveRequest(id: string, decision: 'approved' | 'rejected', note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!UUID.test(id)) throw new LeaveRequestError('Malformed leave request')
    const by = await actor(['manager', 'owner']); const rid = (await getRestaurant()).id
    return await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:leave:' || ${rid}, 0))`
      const [req] = await tx<{ id: string; staff_id: string; start_date: string; end_date: string; status: string }[]>`select id, staff_id, start_date::text, end_date::text, status from leave_requests where restaurant_id = ${rid} and id = ${id} for update`
      if (!req) throw new LeaveRequestError('Leave request not found')
      if (req.status !== 'pending') throw new LeaveRequestError('This leave request has already been decided')
      if (decision === 'approved') {
        const ds = dates(req.start_date, req.end_date)
        const [policy] = await tx<{ annual_days: string; carry_forward: boolean }[]>`select p.annual_days::text, p.carry_forward from leave_requests r join leave_policies p on p.restaurant_id = r.restaurant_id and p.id = r.policy_id where r.restaurant_id = ${rid} and r.id = ${id}`
        const [{ used }] = await tx<{ used: string }[]>`select coalesce(sum(requested_days), 0)::text as used from leave_requests where restaurant_id = ${rid} and staff_id = ${req.staff_id} and status = 'approved' and id <> ${id}`
        const year = Number(req.start_date.slice(0, 4))
        const [prior] = await tx<{ annual_days: string; used: string; ledger: string | null }[]>`select p.annual_days::text,
          coalesce((select sum(requested_days) from leave_requests where restaurant_id = ${rid} and staff_id = ${req.staff_id} and status = 'approved' and start_date < make_date(${year}, 1, 1) and end_date >= make_date(${year - 1}, 1, 1)), 0)::text as used,
          (select carried_days::text from leave_carry_forward_ledger where restaurant_id = ${rid} and staff_id = ${req.staff_id} and source_year = ${year - 1} and target_year = ${year}) as ledger
          from leave_policies p where p.restaurant_id = ${rid} and p.id = (select policy_id from leave_requests where restaurant_id = ${rid} and id = ${id})`
        const carry = prior?.ledger !== null && prior?.ledger !== undefined
          ? Number(prior.ledger)
          : policy?.carry_forward ? Math.max(Number(prior?.annual_days ?? 0) - Number(prior?.used ?? 0), 0) : 0
        if (!policy || Number(used) + ds.length > Number(policy.annual_days) + carry) throw new LeaveRequestError(`Approval exceeds the available allowance of ${Number(policy?.annual_days ?? 0) + carry} days`)
        const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from attendance_current where restaurant_id = ${rid} and staff_id = ${req.staff_id} and att_date between ${req.start_date}::date and ${req.end_date}::date and status in ('present', 'half')`
        if (n > 0) throw new LeaveRequestError('Cannot approve leave over a present or half-day attendance mark')
        await tx`
          insert into attendance (restaurant_id, att_date, staff_id, status, extra_hours, entered_by)
          select ${rid}, d::date, ${req.staff_id}, 'leave', null, ${by}
          from generate_series(${req.start_date}::date, ${req.end_date}::date, interval '1 day') d
          where not exists (
            select 1 from attendance_current a
            where a.restaurant_id = ${rid} and a.staff_id = ${req.staff_id}
              and a.att_date = d::date and a.status = 'leave'
          )`
      }
      await tx`update leave_requests set status = ${decision}, decided_by = ${by}, decided_at = now(), decision_note = ${note.trim() || null} where restaurant_id = ${rid} and id = ${id}`
      return { ok: true as const }
    })
  } catch (e) { return result(e) }
}
