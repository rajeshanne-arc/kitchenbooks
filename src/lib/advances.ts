// MONEY OUT THAT HAS NOT COME BACK — the arithmetic, pure.
//
// Kept out of the components so it is asserted by value rather than read off a
// screen, and out of SQL so the reasoning is legible: a window function can be
// made to do this and nobody can then read it.

/** ISO 'YYYY-MM-DD' → whole months between, by calendar month rather than by
 *  dividing days: an instalment is a MONTHLY event, and 30-day arithmetic
 *  drifts a month every two years. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

/** 'YYYY-MM-DD' → 'Apr 2027'. A loan ends in a MONTH, not on a day — the day
 *  depends on when payroll is run, which nobody has promised. */
export function monthLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

export type LoanProgress =
  | { known: false; why: string }
  | {
      known: true
      paid: number
      total: number
      left: string
      ends: string | null
      /** instalments that should have been taken by now and were not. A month
       *  skipped is the thing expected_end exists to make visible. */
      behind: number
    }

/**
 * HOW FAR THROUGH A LOAN SOMEBODY IS.
 *
 * IT REFUSES RATHER THAN GUESSES IN TWO CASES, and both are real:
 *
 *   NO INSTALMENT — then it is an advance, not a loan, and there is no
 *   schedule to be partway through.
 *
 *   BOTH AN ADVANCE AND A LOAN AT ONCE. `staff_owes.recovered` sums every
 *   payroll line for that person and is not attributed per advance, so the
 *   split between the two is not recoverable from the data. Showing "3 of 8"
 *   built from a recovery that partly paid something else would be a confident
 *   wrong number on a screen somebody lends money from.
 */
export function loanProgress(row: {
  loans_given: string | null
  advances_given: string | null
  instalment: string | null
  recovered: string
  outstanding: string
  expected_end: string | null
}, today: string): LoanProgress {
  const inst = Number(row.instalment ?? 0)
  if (!(inst > 0)) return { known: false, why: 'no instalment is set, so this is an advance rather than a loan' }
  const loan = Number(row.loans_given ?? 0)
  if (!(loan > 0)) return { known: false, why: 'nothing on this person is recorded as a loan' }
  if (Number(row.advances_given ?? 0) > 0) {
    return {
      known: false,
      why: 'they hold an advance as well as a loan, and what has been recovered is not split between the two — the total owed is right, the instalment count would not be',
    }
  }
  const total = Math.ceil(loan / inst)
  const paid = Math.min(total, Math.floor(Number(row.recovered) / inst))
  // WHERE THE SCHEDULE SHOULD HAVE REACHED BY NOW.
  //
  // `expected_end` is the LAST instalment, so the first sits (total − 1)
  // months before it and the count due by `today` is INCLUSIVE of both ends.
  // Worked: ₹40,000 at ₹5,000 ending Apr 2027 is eight instalments starting
  // Sep 2026, so by Jan 2027 five are due — Sep, Oct, Nov, Dec, Jan. The first
  // form of this counted the months BETWEEN and reported four, which is the
  // fencepost, and it is why this is asserted by value rather than read.
  let behind = 0
  if (row.expected_end !== null) {
    const due = Math.max(0, Math.min(total, monthsBetween(row.expected_end, today) + total))
    behind = Math.max(0, due - paid)
  }
  return { known: true, paid, total, left: row.outstanding, ends: row.expected_end, behind }
}

/**
 * EXPOSURE, IN THE UNIT THAT MATTERS.
 *
 * The thing that goes wrong with lending to staff is not the rupees, it is
 * lending more than can be recovered before somebody leaves. Months of salary
 * is that number, and it is the one a person can act on.
 */
export function exposureText(months: string | null): string | null {
  if (months === null || months === '') return null
  const m = Number(months)
  if (!Number.isFinite(m) || m <= 0) return null
  if (m < 0.1) return 'under a tenth of a month’s salary'
  return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)} month${m === 1 ? '' : 's'} of salary`
}

/** Above this a credit has stopped being a thing that absorbs itself against
 *  the next delivery. A fortnight on either side of a monthly buying cycle. */
export const STALE_CREDIT_DAYS = 45

/**
 * WHETHER A VENDOR CREDIT WILL COME BACK AS GOODS OR HAS TO BE CHASED AS CASH.
 *
 * Never a bare number of days: the reader has to know which of the two this is
 * before the figure means anything.
 */
export function creditAge(days: number | null): { stale: boolean; text: string } {
  if (days === null) {
    return { stale: true, text: 'we have never bought from them, so this will not come back as goods' }
  }
  if (days <= STALE_CREDIT_DAYS) {
    return { stale: false, text: `last bill ${days} day${days === 1 ? '' : 's'} ago — it comes off the next one` }
  }
  return {
    stale: true,
    text: `no bill for ${days} days — this will not absorb itself, it has to be asked for`,
  }
}

/**
 * WHY THE NUMBER IS LOWER THAN WHAT THEY EARNED.
 *
 * A payslip showing ₹8,200 against ₹18,200 earned, with the difference sitting
 * in three unlabelled columns, is the shape every wage dispute starts from.
 * The sentence names each deduction and what is still owed afterwards.
 *
 * IT SAYS NOTHING WHEN NOTHING WAS DEDUCTED. A line that reads "₹18,200 — no
 * deductions" is a sentence to read and dismiss on every row of every run.
 *
 * PURE, AND IN PAISE. The parts are summed as integers and compared against
 * the stored net, because adding rounded rupee strings is the associativity
 * fault this codebase has met four times — and here it would put a sentence on
 * a payslip that disagrees with the figure beside it by a paisa.
 */
export function payslipReason(
  line: {
    earned: string
    overtime: string
    advance_recovered: string
    other_deduction: string
    withholding: string
    net_payable: string
  },
  toPaise: (s: string) => number,
  money: (s: string) => string,
  /** what they still owe AFTER this run — null where this screen cannot say */
  leftOwing: string | null,
): string | null {
  const adv = toPaise(line.advance_recovered)
  const oth = toPaise(line.other_deduction)
  const wth = toPaise(line.withholding)
  const cut = adv + oth + wth
  if (cut <= 0) return null

  const parts: string[] = []
  if (adv > 0) parts.push(`${money(line.advance_recovered)} recovered against what they owe`)
  if (oth > 0) parts.push(`${money(line.other_deduction)} other deduction`)
  if (wth > 0) parts.push(`${money(line.withholding)} withheld`)
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`

  // THE GAP IS SUMMED IN PAISE, never by subtracting two rupee strings: the
  // deductions are what make the number lower, so the sentence is built from
  // them rather than from a second arithmetic on the total.
  const lower = (cut / 100).toFixed(2)

  const tail =
    adv <= 0
      ? ''
      : leftOwing === null
        ? ''
        : Number(leftOwing) > 0
          ? ` ${money(leftOwing)} is still owed.`
          : ' Nothing is left owing.'

  return `${money(line.net_payable)} — ${money(lower)} less than earned, being ${list}.${tail}`
}

/**
 * ISO date + N whole months, clamping the day to the shorter month.
 *
 * A loan's instalments are MONTHLY events, so its end is reached by counting
 * months rather than by adding 30-day blocks — which drifts a month every two
 * years. The 31st of a month plus one lands on the 28th, 29th or 30th rather
 * than rolling into the following month, because a schedule that silently
 * gains a month is worse than one that pays a day early.
 */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const target = m - 1 + n
  const ty = y + Math.floor(target / 12)
  const tm = ((target % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
