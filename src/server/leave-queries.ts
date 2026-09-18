import 'server-only'
import { tsql } from '@/lib/db'

export type LeavePolicyRow = {
  id: string; code: string; name: string; annual_days: string; paid_days: string
  carry_forward: boolean; status: 'active' | 'inactive'; assigned_staff: number
}

/** @scope now */
export async function listLeavePolicies(restaurantId: string): Promise<LeavePolicyRow[]> {
  return tsql<LeavePolicyRow[]>`
    select p.id, p.code, p.name, p.annual_days::text, p.paid_days::text,
           p.carry_forward, p.status,
           (select count(*)::int from staff_leave_policy_assignments a
            join staff s on s.restaurant_id = a.restaurant_id and s.id = a.staff_id
            where a.restaurant_id = p.restaurant_id and a.policy_id = p.id
              and a.effective_to is null and s.status = 'active') as assigned_staff
    from leave_policies p
    where p.restaurant_id = ${restaurantId}
    order by p.status asc, p.name asc`
}

export type LeaveAssignmentRow = { staff_id: string; policy_id: string; policy_name: string; effective_from: string; effective_to: string | null }

/** @scope now */
export async function listCurrentLeaveAssignments(restaurantId: string): Promise<LeaveAssignmentRow[]> {
  return tsql<LeaveAssignmentRow[]>`
    select a.staff_id, a.policy_id, p.name as policy_name,
           a.effective_from::text as effective_from,
           a.effective_to::text as effective_to
    from staff_leave_policy_assignments a
    join leave_policies p on p.restaurant_id = a.restaurant_id and p.id = a.policy_id
    join staff s on s.restaurant_id = a.restaurant_id and s.id = a.staff_id
    where a.restaurant_id = ${restaurantId} and s.status = 'active'
    order by s.code, a.effective_from desc`
}
