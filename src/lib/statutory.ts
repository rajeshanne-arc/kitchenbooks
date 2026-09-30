/** Calculate only from the restaurant's effective accountant-entered inputs.
 * No jurisdiction defaults are embedded; TDS remains frozen payroll data. */
export type StatutoryInputs = {
  earned: string
  pfEmployeePct: string | null
  pfEmployerPct: string | null
  pfWageCap: string | null
  esiEmployeePct: string | null
  esiEmployerPct: string | null
  esiWageCap: string | null
}

function amount(value: string | null | undefined): number {
  const n = Number(value ?? '')
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function contribution(earned: number, pct: string | null, cap: string | null): string {
  const rate = amount(pct)
  const limit = amount(cap)
  const wage = limit > 0 ? Math.min(earned, limit) : earned
  return ((wage * rate) / 100).toFixed(2)
}

export function calculateStatutoryAmounts(input: StatutoryInputs) {
  const earned = amount(input.earned)
  return {
    pfEmployee: contribution(earned, input.pfEmployeePct, input.pfWageCap),
    pfEmployer: contribution(earned, input.pfEmployerPct, input.pfWageCap),
    esiEmployee: contribution(earned, input.esiEmployeePct, input.esiWageCap),
    esiEmployer: contribution(earned, input.esiEmployerPct, input.esiWageCap),
  }
}
