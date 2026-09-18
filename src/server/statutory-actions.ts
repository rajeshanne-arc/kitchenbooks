'use server'
import { z } from 'zod'
import { tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const PCT = /^\d{1,3}(\.\d{1,4})?$/
const MONEY = /^\d{1,12}(\.\d{1,2})?$/
const optional = (re: RegExp) => z.string().trim().regex(re).or(z.literal(''))
const optionalPct = z.string().trim().regex(PCT).or(z.literal('')).transform((value) => {
  if (value !== '' && Number(value) > 100) throw new Error('percentage must be between 0 and 100')
  return value
})

function assertRealDate(value: string) {
  if (!DATE.test(value)) throw new Error('Effective date must be YYYY-MM-DD')
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Effective date is not a real calendar date')
}

export async function saveStatutoryConfig(raw: Record<string, string>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = z.object({
      effectiveFrom: z.string().regex(DATE), jurisdiction: z.string().trim().min(1).max(30),
      pfEmployeePct: optionalPct, pfEmployerPct: optionalPct, pfWageCap: optional(MONEY),
      esiEmployeePct: optionalPct, esiEmployerPct: optionalPct, esiWageCap: optional(MONEY),
      tdsRegime: z.string().trim().max(80), note: z.string().trim().max(300),
    }).parse(raw)
    const user = await getSessionUser()
    if (!user || !['accountant', 'owner'].includes(user.role)) throw new Error('Only an accountant or owner can save statutory configuration')
    assertRealDate(input.effectiveFrom)
    const rid = (await getRestaurant()).id
    await tsql`insert into payroll_statutory_configs
      (restaurant_id, effective_from, jurisdiction, pf_employee_pct, pf_employer_pct, pf_wage_cap,
       esi_employee_pct, esi_employer_pct, esi_wage_cap, tds_regime, note, entered_by)
      values (${rid}, ${input.effectiveFrom}::date, ${input.jurisdiction},
        ${input.pfEmployeePct || null}::numeric, ${input.pfEmployerPct || null}::numeric, ${input.pfWageCap || null}::numeric,
        ${input.esiEmployeePct || null}::numeric, ${input.esiEmployerPct || null}::numeric, ${input.esiWageCap || null}::numeric,
        ${input.tdsRegime || null}, ${input.note || null}, ${user.username})`
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof z.ZodError ? 'Check the statutory fields — nothing was saved' : e instanceof Error ? e.message : 'Could not save statutory configuration' }
  }
}
