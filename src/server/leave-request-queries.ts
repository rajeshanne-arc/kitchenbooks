import 'server-only'
import { tsql } from '@/lib/db'

export type LeaveRequestRow = {
  id: string; staff_id: string; staff_code: string; staff_name: string
  policy_name: string | null; start_date: string; end_date: string
  requested_days: string; status: 'pending' | 'approved' | 'rejected'
  note: string | null; requested_by: string; decided_by: string | null
  decision_note: string | null; created_at: string
}

export type LeaveBalanceRow = {
  staff_id: string; staff_code: string; staff_name: string; allowance: string
  carry_forward: string; carry_forward_source: 'ledger' | 'suggested' | 'none'
  approved_days: string; remaining: string
}

/** @scope all-time */
export async function listLeaveRequests(restaurantId: string, year: number): Promise<LeaveRequestRow[]> {
  return tsql<LeaveRequestRow[]>`
    select r.id, r.staff_id, s.code as staff_code, s.name as staff_name,
           p.name as policy_name, r.start_date::text, r.end_date::text,
           r.requested_days::text, r.status, r.note, r.requested_by,
           r.decided_by, r.decision_note, r.created_at::text
    from leave_requests r
    join staff s on s.restaurant_id = r.restaurant_id and s.id = r.staff_id
    left join leave_policies p on p.restaurant_id = r.restaurant_id and p.id = r.policy_id
    where r.restaurant_id = ${restaurantId}
      and r.start_date < make_date(${year + 1}, 1, 1)
      and r.end_date >= make_date(${year}, 1, 1)
    order by (r.status = 'pending') desc, r.start_date desc, s.code`
}

/** @scope all-time */
export async function getLeaveBalances(restaurantId: string, year: number): Promise<LeaveBalanceRow[]> {
  return tsql`
    with assigned as (
      select distinct on (a.staff_id) a.staff_id, p.annual_days, p.carry_forward
      from staff_leave_policy_assignments a
      join leave_policies p on p.restaurant_id = a.restaurant_id and p.id = a.policy_id
      where a.restaurant_id = ${restaurantId} and p.status = 'active'
        and a.effective_from <= make_date(${year}, 12, 31)
        and (a.effective_to is null or a.effective_to >= make_date(${year}, 1, 1))
      order by a.staff_id, a.effective_from desc
    ), previous_assigned as (
      select distinct on (a.staff_id) a.staff_id, p.annual_days
      from staff_leave_policy_assignments a
      join leave_policies p on p.restaurant_id = a.restaurant_id and p.id = a.policy_id
      where a.restaurant_id = ${restaurantId} and p.status = 'active'
        and a.effective_from <= make_date(${year - 1}, 12, 31)
        and (a.effective_to is null or a.effective_to >= make_date(${year - 1}, 1, 1))
      order by a.staff_id, a.effective_from desc
    ), previous_used as (
      select staff_id, sum(requested_days) as days
      from leave_requests where restaurant_id = ${restaurantId} and status = 'approved'
        and start_date < make_date(${year}, 1, 1) and end_date >= make_date(${year - 1}, 1, 1)
      group by staff_id
    ), used as (
      select staff_id, sum(requested_days) as days
      from leave_requests
      where restaurant_id = ${restaurantId} and status = 'approved'
        and start_date < make_date(${year + 1}, 1, 1) and end_date >= make_date(${year}, 1, 1)
      group by staff_id
    )
    select s.id as staff_id, s.code as staff_code, s.name as staff_name,
           coalesce(a.annual_days, 0)::text as allowance,
           coalesce(cf.carried_days, case when coalesce(a.carry_forward, false) then greatest(coalesce(pa.annual_days, 0) - coalesce(pu.days, 0), 0) else 0 end, 0)::text as carry_forward,
           case when cf.id is not null then 'ledger' when coalesce(a.carry_forward, false) then 'suggested' else 'none' end as carry_forward_source,
           coalesce(u.days, 0)::text as approved_days,
           greatest(coalesce(a.annual_days, 0) + coalesce(cf.carried_days, case when coalesce(a.carry_forward, false) then greatest(coalesce(pa.annual_days, 0) - coalesce(pu.days, 0), 0) else 0 end, 0) - coalesce(u.days, 0), 0)::text as remaining
    from staff s left join assigned a on a.staff_id = s.id left join used u on u.staff_id = s.id
      left join previous_assigned pa on pa.staff_id = s.id left join previous_used pu on pu.staff_id = s.id
      left join leave_carry_forward_ledger cf on cf.restaurant_id = s.restaurant_id and cf.staff_id = s.id and cf.target_year = ${year}
    where s.restaurant_id = ${restaurantId} and s.status = 'active'
    order by s.code`
}
