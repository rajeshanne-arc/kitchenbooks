import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { getPayrollLines, getPayrollRun } from '@/server/payroll-queries'
import { canAccess } from '@/lib/roles'
import { csvFilename, toCsv } from '@/lib/csv'
import { tsql } from '@/lib/db'
import { calculateStatutoryAmounts } from '@/lib/statutory'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Generic accountant export. Values are the frozen run's recorded values;
 * statutory rates are never invented and nothing is filed automatically. */
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user || !canAccess(user.role, '/accounts/payroll')) return new NextResponse('Not yours to download', { status: 403 })
  const id = new URL(request.url).searchParams.get('run') ?? ''
  if (!UUID.test(id)) return new NextResponse('Unknown payroll run', { status: 400 })
  const restaurant = await getRestaurant(); const run = await getPayrollRun(restaurant.id, id)
  if (!run) return new NextResponse('Payroll run not found', { status: 404 })
  const lines = await getPayrollLines(run.id)
  const identifiers = await tsql<{ id: string; pan: string | null; uan: string | null; pf_number: string | null; esic_number: string | null }[]>`
    select id, pan, uan, pf_number, esic_number from staff
    where restaurant_id = ${restaurant.id} and id = any(${lines.map((line) => line.staff_id)}::uuid[])
  `
  let config: { effective_from: string; jurisdiction: string; pf_employee_pct: string | null; pf_employer_pct: string | null; pf_wage_cap: string | null; esi_employee_pct: string | null; esi_employer_pct: string | null; esi_wage_cap: string | null; tds_regime: string | null } | undefined
  try {
    const rows = await tsql<typeof config[]>`
      select effective_from::text, jurisdiction, pf_employee_pct::text, pf_employer_pct::text, pf_wage_cap::text,
        esi_employee_pct::text, esi_employer_pct::text, esi_wage_cap::text, tds_regime
      from payroll_statutory_configs
      where restaurant_id = ${restaurant.id} and effective_from <= ${run.period_end}::date
      order by effective_from desc limit 1`
    config = rows[0]
  } catch (error) {
    if ((error as { code?: string }).code !== '42P01') throw error
  }
  const byStaff = new Map(identifiers.map((row) => [row.id, row]))
  const csv = toCsv(
    ['Period start', 'Period end', 'Run status', 'Employee code', 'Employee', 'PAN', 'UAN', 'PF number', 'ESIC number', 'Days in period', 'Days paid', 'Base salary', 'Earned', 'Overtime', 'Advance recovered', 'Other deduction', 'Withholding (frozen)', 'Net payable', 'Paid on', 'Pay mode', 'Statutory config effective', 'Jurisdiction', 'PF employee %', 'PF employee amount', 'PF employer %', 'PF employer amount', 'PF wage cap', 'ESI employee %', 'ESI employee amount', 'ESI employer %', 'ESI employer amount', 'ESI wage cap', 'TDS regime'],
    lines.map((line) => { const identity = byStaff.get(line.staff_id); const statutory = calculateStatutoryAmounts({ earned: line.earned, pfEmployeePct: config?.pf_employee_pct ?? null, pfEmployerPct: config?.pf_employer_pct ?? null, pfWageCap: config?.pf_wage_cap ?? null, esiEmployeePct: config?.esi_employee_pct ?? null, esiEmployerPct: config?.esi_employer_pct ?? null, esiWageCap: config?.esi_wage_cap ?? null }); return [run.period_start, run.period_end, run.status, line.staff_code, line.staff_name, identity?.pan, identity?.uan, identity?.pf_number, identity?.esic_number, line.days_in_period, line.days_paid, line.base_salary, line.earned, line.overtime, line.advance_recovered, line.other_deduction, line.withholding, line.net_payable, line.paid_on, line.pay_mode, config?.effective_from, config?.jurisdiction, config?.pf_employee_pct, statutory.pfEmployee, config?.pf_employer_pct, statutory.pfEmployer, config?.pf_wage_cap, config?.esi_employee_pct, statutory.esiEmployee, config?.esi_employer_pct, statutory.esiEmployer, config?.esi_wage_cap, config?.tds_regime] }),
  )
  return new NextResponse(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${csvFilename('payroll', run.period_start, run.period_end)}"`, 'cache-control': 'no-store' } })
}
