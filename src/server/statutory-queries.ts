import 'server-only'
import { tsql } from '@/lib/db'

export type StatutoryConfigRow = {
  id: string; effective_from: string; jurisdiction: string
  pf_employee_pct: string | null; pf_employer_pct: string | null; pf_wage_cap: string | null
  esi_employee_pct: string | null; esi_employer_pct: string | null; esi_wage_cap: string | null
  tds_regime: string | null; note: string | null; entered_by: string
}

export async function listStatutoryConfigs(restaurantId: string): Promise<StatutoryConfigRow[]> {
  try {
    return await tsql<StatutoryConfigRow[]>`select id, effective_from::text as effective_from, jurisdiction,
      pf_employee_pct::text, pf_employer_pct::text, pf_wage_cap::text,
      esi_employee_pct::text, esi_employer_pct::text, esi_wage_cap::text,
      tds_regime, note, entered_by from payroll_statutory_configs
      where restaurant_id = ${restaurantId} order by effective_from desc`
  } catch (error) {
    // During a staged rollout the code can reach production before the
    // database-owner migration. Keep the existing People screen readable;
    // do not hide any other database failure.
    if ((error as { code?: string }).code === '42P01') return []
    throw error
  }
}
