import 'server-only'
import { tsql } from '@/lib/db'

export type SalaryStructureRow = { id: string; staff_id: string; staff_name: string; effective_from: string; base_salary: string; note: string | null; entered_by: string }
export async function listSalaryStructures(restaurantId: string): Promise<SalaryStructureRow[]> {
  return tsql<SalaryStructureRow[]>`select ss.id, ss.staff_id, s.name as staff_name, ss.effective_from::text as effective_from, ss.base_salary::text as base_salary, ss.note, ss.entered_by from salary_structures ss join staff s on s.restaurant_id = ss.restaurant_id and s.id = ss.staff_id where ss.restaurant_id = ${restaurantId} order by ss.effective_from desc, s.code asc`
}
