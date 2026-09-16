// Payroll, read side.
//
// THE OLD SHEET PAID 34 DAYS IN A 30-DAY MONTH because it summed days
// worked PLUS weekly offs with no cap. Attendance here is one row per
// person per day with the latest winning (attendance_current), so it cannot
// recur — and payroll_lines carries CHECK (days_paid <= days_in_period)
// saying so out loud. That constraint is the whole reason payroll is
// buildable now and was not before.
//
// THE PAY LAW LIVES IN THE DATABASE, not here: present = 1, half = 0.5,
// off = 1 (off is PAID — a stated assumption), leave and absent = 0,
// divided by the REAL days of the period. labour_cost_by_section has
// applied exactly that since phase 5; the draft below reproduces it
// verbatim rather than inventing a second arithmetic that could drift.
import 'server-only'
import type postgres from 'postgres'
import { sql, tsql } from '@/lib/db'
import type {
  AdvanceOutstanding,
  PayrollDraftLine,
  PayrollLineRow,
  PayrollRunRow,
  StaffIdentity,
} from '@/lib/types'

/** The pay law, as SQL. Kept as one string so the draft and any future
 *  reader share the exact expression the view uses. */
const PAY_FACTOR = `
  case a.status
    when 'present' then 1::numeric
    when 'half' then 0.5
    when 'off' then 1::numeric
    else 0::numeric
  end`

/** WHAT IS WAITING ON ME. draft -> approved -> paid is a chain with three
 *  different people in it, so "which runs need me" is a real question that a
 *  single list of everything cannot answer. `all` stays the default: the
 *  status is on every row anyway, and a filtered default would hide work. */
export async function listPayrollRuns(restaurantId: string, limit = 24,
  status: 'all' | 'draft' | 'approved' | 'paid' = 'all',
): Promise<PayrollRunRow[]> {
  return tsql<PayrollRunRow[]>`
    select r.id, r.doc_no, r.period_start::text as period_start, r.period_end::text as period_end,
           r.status, r.prepared_by, r.prepared_at::text as prepared_at,
           r.approved_by, r.approved_at::text as approved_at, r.note,
           coalesce(l.lines, 0)::int as line_count,
           coalesce(l.net, 0)::text as net_total
    from payroll_runs r
    left join (
      select run_id, count(*) as lines, sum(net_payable) as net
      from payroll_lines group by run_id
    ) l on l.run_id = r.id
    where r.restaurant_id = ${restaurantId}
      ${status === 'all' ? sql`` : sql`and r.status = ${status}`}
    order by r.period_start desc, r.prepared_at desc
    limit ${limit}`
}

export async function getPayrollRun(restaurantId: string, id: string): Promise<PayrollRunRow | null> {
  const rows = await tsql<PayrollRunRow[]>`
    select r.id, r.doc_no, r.period_start::text as period_start, r.period_end::text as period_end,
           r.status, r.prepared_by, r.prepared_at::text as prepared_at,
           r.approved_by, r.approved_at::text as approved_at, r.note,
           coalesce(l.lines, 0)::int as line_count,
           coalesce(l.net, 0)::text as net_total
    from payroll_runs r
    left join (
      select run_id, count(*) as lines, sum(net_payable) as net
      from payroll_lines group by run_id
    ) l on l.run_id = r.id
    where r.restaurant_id = ${restaurantId} and r.id = ${id}`
  return rows[0] ?? null
}

/** The FROZEN figures. Every one of these was worked out at prepare time and
 *  stored; nothing on the run screen recomputes them, because a run someone
 *  approved must still say next year what it said the day it was approved. */
export async function getPayrollLines(runId: string): Promise<PayrollLineRow[]> {
  return tsql<PayrollLineRow[]>`
    select pl.id, pl.staff_id, s.code as staff_code, s.name as staff_name,
           sec.name as section_name, s.grade,
           pl.days_in_period::text as days_in_period, pl.days_paid::text as days_paid,
           pl.base_salary::text as base_salary, pl.earned::text as earned,
           pl.overtime::text as overtime, pl.advance_recovered::text as advance_recovered,
           pl.other_deduction::text as other_deduction, pl.withholding::text as withholding,
           pl.net_payable::text as net_payable,
           pl.pay_mode, pl.account_id, pl.paid_on::text as paid_on, pl.note
    from payroll_lines pl
    join staff s on s.id = pl.staff_id
    left join sections sec on sec.id = s.section_id
    where pl.run_id = ${runId}
    order by s.code asc`
}

/**
 * The draft — computed, never stored, and shown to the accountant BEFORE
 * anything is written. Every figure here is editable on screen; the moment
 * the run is prepared they are frozen, because `payroll_lines` has no
 * UPDATE grant on any amount. That is deliberate: a run is a decision, and
 * a decision that can be quietly edited afterwards is not one.
 *
 * CONTRACT STAFF ARE EXCLUDED — they are billed by their vendor, and their
 * money is already in contract_bills. Same exclusion the pay-law view makes.
 *
 * A staff member with NO base_salary appears with earned 0 and is flagged:
 * they worked and nobody has said what they are paid, which is a question
 * to ask rather than a zero to bank.
 */
export async function getPayrollDraft(
  restaurantId: string,
  from: string,
  to: string,
  /** THE CALLER MAY LEND ITS TRANSACTION. A gate that writes an advance and
   *  then asks what the draft offers must be asking on the SAME handle — an
   *  uncommitted row is invisible to a second connection, so `tsql` here would
   *  see no advance, offer nothing, and the probe would pass by testing a
   *  person who owes nothing. The `getClosePrefill` shape, for its reason. */
  tx?: postgres.TransactionSql,
): Promise<PayrollDraftLine[]> {
  const q = (tx ?? tsql) as typeof tsql
  return q<PayrollDraftLine[]>`
    with days as (
      select (${to}::date - ${from}::date + 1)::numeric as n
    ),
    marks as (
      select a.staff_id, sum(${sql.unsafe(PAY_FACTOR)}) as days_paid
      from attendance_current a
      join staff st on st.id = a.staff_id
      where st.restaurant_id = ${restaurantId}
        and a.att_date between ${from}::date and ${to}::date
      group by a.staff_id
    ),
    -- What is still owed on advances: everything advanced, less every
    -- recovery already frozen onto an earlier run. Reversal rows carry a
    -- negative amount, so they net themselves out of the first sum.
    advanced as (
      select staff_id, sum(amount) as total,
             -- THE INSTALMENT MAKES IT A LOAN. An advance is recovered in
             -- full from the next run; a loan is recovered a slice at a time,
             -- and offering the whole balance on one would take a month's
             -- wages off somebody who agreed to eight.
             max(instalment) as instalment,
             max(expected_end) as expected_end
      from staff_advances
      where restaurant_id = ${restaurantId}
      group by staff_id
    ),
    recovered as (
      select pl.staff_id, sum(pl.advance_recovered) as total
      from payroll_lines pl
      join payroll_runs r on r.id = pl.run_id
      where r.restaurant_id = ${restaurantId} and r.status <> 'cancelled'
      group by pl.staff_id
    )
    select s.id as staff_id, s.code as staff_code, s.name as staff_name,
           sec.name as section_name, s.grade, s.pay_mode,
           (select n from days)::text as days_in_period,
           -- capped at the period: the CHECK would refuse more, and a
           -- silent refusal at insert time is worse than an honest cap here
           least(coalesce(m.days_paid, 0), (select n from days))::text as days_paid,
           coalesce(s.base_salary, 0)::text as base_salary,
           (s.base_salary is null) as unsalaried,
           round(coalesce(s.base_salary, 0)
                 * least(coalesce(m.days_paid, 0), (select n from days))
                 / (select n from days), 2)::text as earned,
           greatest(coalesce(adv.total, 0) - coalesce(rc.total, 0), 0)::text as advance_outstanding,
           adv.instalment::text as instalment,
           adv.expected_end::text as expected_end,
           -- WHAT THIS RUN SHOULD TAKE, computed rather than typed.
           --
           -- advance_recovered exists and has been keyed in by hand, so a
           -- manager who forgets it pays somebody twice — which is the dispute
           -- this whole thing is for. The full balance for an advance, one
           -- instalment for a loan, and never more than is outstanding: a
           -- final instalment is whatever is left, not the round number.
           least(
             coalesce(adv.instalment, greatest(coalesce(adv.total, 0) - coalesce(rc.total, 0), 0)),
             greatest(coalesce(adv.total, 0) - coalesce(rc.total, 0), 0)
           )::text as advance_suggested
    from staff s
    left join sections sec on sec.id = s.section_id
    left join marks m on m.staff_id = s.id
    left join advanced adv on adv.staff_id = s.id
    left join recovered rc on rc.staff_id = s.id
    where s.restaurant_id = ${restaurantId}
      and s.status = 'active'
      and s.employment_type <> 'contract'
    order by s.code asc`
}

/** Advances still owed, per person — the figure the draft offers as
 *  recovery and the Advances panel shows on its own. */
export async function getOutstandingAdvances(restaurantId: string): Promise<AdvanceOutstanding[]> {
  return tsql<AdvanceOutstanding[]>`
    with advanced as (
      select staff_id, sum(amount) as total, max(adv_date) as last_advance
      from staff_advances where restaurant_id = ${restaurantId} group by staff_id
    ),
    recovered as (
      select pl.staff_id, sum(pl.advance_recovered) as total
      from payroll_lines pl
      join payroll_runs r on r.id = pl.run_id
      where r.restaurant_id = ${restaurantId} and r.status <> 'cancelled'
      group by pl.staff_id
    )
    select s.id as staff_id, s.code as staff_code, s.name as staff_name,
           (coalesce(adv.total, 0) - coalesce(rc.total, 0))::text as outstanding,
           adv.last_advance::text as last_advance
    from staff s
    join advanced adv on adv.staff_id = s.id
    left join recovered rc on rc.staff_id = s.id
    where s.restaurant_id = ${restaurantId}
      and coalesce(adv.total, 0) - coalesce(rc.total, 0) <> 0
    order by (coalesce(adv.total, 0) - coalesce(rc.total, 0)) desc`
}

/**
 * The identifier block — bank, PAN, UAN, PF, ESIC, date of birth, gender.
 *
 * OWNER AND ACCOUNTANT ONLY, never the manager. The manager marks
 * attendance; they have no reason to hold anybody's bank account number or
 * date of birth, and "no reason to hold it" is the whole of data
 * protection in one sentence. The matrix keeps them out of /accounts, which
 * is why this lives here rather than beside the roster.
 */
/** ONE person's identifiers, for the owner's half of the staff form. Read
 *  separately from getStaffDetail on purpose: StaffRow crosses the wire to a
 *  MANAGER on the same screen, and a field they must not hold must not be in
 *  the payload at all — not merely unrendered.
 * @scope not-a-figure
 */
export async function getStaffIdentity(restaurantId: string, staffId: string): Promise<StaffIdentity | null> {
  const rows = await tsql<StaffIdentity[]>`
    select s.id, s.code, s.name, s.designation, sec.name as section_name,
           s.employment_type, s.pay_mode,
           s.base_salary::text as base_salary,
           s.bank_name, s.account_no, s.ifsc, s.upi_id,
           s.pan, s.uan, s.pf_number, s.esic_number,
           s.dob::text as dob, s.gender, s.aadhaar, s.address
    from staff s
    left join sections sec on sec.id = s.section_id
    where s.restaurant_id = ${restaurantId} and s.id = ${staffId}`
  return rows[0] ?? null
}

export async function listStaffIdentities(restaurantId: string): Promise<StaffIdentity[]> {
  return tsql<StaffIdentity[]>`
    select s.id, s.code, s.name, s.designation, sec.name as section_name,
           s.employment_type, s.pay_mode,
           s.base_salary::text as base_salary,
           s.bank_name, s.account_no, s.ifsc, s.upi_id,
           s.pan, s.uan, s.pf_number, s.esic_number,
           s.dob::text as dob, s.gender, s.aadhaar, s.address
    from staff s
    left join sections sec on sec.id = s.section_id
    where s.restaurant_id = ${restaurantId} and s.status = 'active'
    order by s.code asc`
}

/**
 * WHAT EACH PERSON OWES RIGHT NOW, keyed by staff id.
 *
 * IT DOES NOT READ `staff_owes`, AND THAT IS NOT A PREFERENCE. That view's
 * recovered leg filters `r.status <> 'void'` — and `payroll_runs.status` is
 * draft | approved | paid | cancelled, with no 'void' in the CHECK at all. So
 * the filter excludes nothing and a CANCELLED run's recovery still counts as
 * recovered, which understates what somebody owes and under-recovers them
 * permanently, with nothing on any screen looking wrong. Reported; it needs a
 * migration. `getPayrollDraft` has always had this right, and this is the same
 * arithmetic on the same handle so the two cannot drift.
 *
 * ON THE CALLER'S TRANSACTION, because it is read under the advisory lock the
 * write already holds: what somebody owes must be read in the same breath as
 * the decision that acts on it.
 */
export async function outstandingByStaff(
  tx: postgres.TransactionSql,
  restaurantId: string,
): Promise<Map<string, number>> {
  const rows = await tx<{ staff_id: string; owed: string }[]>`
    with advanced as (
      select staff_id, sum(amount) as total from staff_advances
      where restaurant_id = ${restaurantId} group by staff_id
    ),
    recovered as (
      select pl.staff_id, sum(pl.advance_recovered) as total
      from payroll_lines pl
      join payroll_runs r on r.id = pl.run_id
      where r.restaurant_id = ${restaurantId} and r.status <> 'cancelled'
      group by pl.staff_id
    )
    select a.staff_id::text as staff_id,
           greatest(coalesce(a.total, 0) - coalesce(rc.total, 0), 0)::text as owed
    from advanced a
    left join recovered rc on rc.staff_id = a.staff_id`
  return new Map(rows.map((r) => [r.staff_id, Number(r.owed)]))
}

export type RecoveryDrift = { staff_id: string; name: string; owed: string; recovering: string }

/**
 * WHERE A DRAFT RUN NO LONGER MATCHES WHAT IS OWED.
 *
 * BOTH DIRECTIONS ARE DRIFT, and they are different failures:
 *
 *   RECOVERING MORE THAN IS OWED takes money off somebody's pay that they do
 *   not owe — an advance reversed after the run was prepared.
 *
 *   RECOVERING LESS THAN IS OWED misses an advance taken between preparing
 *   and approving, which is the gap that pays somebody twice and is the whole
 *   reason this runs at approval rather than only at preparation.
 *
 * A WAIVED MONTH IS NOT DRIFT. The owner may deliberately recover less, and
 * this cannot tell that apart from a missed advance — so it compares against
 * what was OWED WHEN THE RUN WAS PREPARED, not against the suggestion. A
 * waiver leaves the balance owed and changes nothing here; a new advance
 * changes the balance and is caught.
 */
export async function recoveryDrift(
  tx: postgres.TransactionSql,
  restaurantId: string,
  runId: string,
): Promise<RecoveryDrift[]> {
  return tx<RecoveryDrift[]>`
    with advanced_now as (
      select staff_id, sum(amount) as total from staff_advances
      where restaurant_id = ${restaurantId} group by staff_id
    ),
    -- EVERY OTHER RUN'S recoveries, so this run's own line is not counted as
    -- already recovered against itself.
    recovered_elsewhere as (
      select pl.staff_id, sum(pl.advance_recovered) as total
      from payroll_lines pl
      join payroll_runs r on r.id = pl.run_id
      where r.restaurant_id = ${restaurantId} and r.status <> 'cancelled' and pl.run_id <> ${runId}
      group by pl.staff_id
    ),
    -- WHAT WAS TRUE WHEN IT WAS PREPARED: the balance the line was written
    -- against, reconstructed as owed-now minus advances taken since.
    taken_since as (
      select a.staff_id, sum(a.amount) as total
      from staff_advances a
      join payroll_runs r on r.id = ${runId}
      where a.restaurant_id = ${restaurantId} and a.created_at > r.prepared_at
      group by a.staff_id
    )
    select pl.staff_id::text as staff_id, st.name,
           greatest(coalesce(an.total, 0) - coalesce(re.total, 0), 0)::text as owed,
           pl.advance_recovered::text as recovering
    from payroll_lines pl
    join staff st on st.id = pl.staff_id
    left join advanced_now an on an.staff_id = pl.staff_id
    left join recovered_elsewhere re on re.staff_id = pl.staff_id
    left join taken_since ts on ts.staff_id = pl.staff_id
    where pl.run_id = ${runId} and pl.restaurant_id = ${restaurantId}
      and (
        -- recovering more than is owed: always wrong
        pl.advance_recovered > greatest(coalesce(an.total, 0) - coalesce(re.total, 0), 0) + 0.005
        -- or an advance appeared after this run was prepared
        or coalesce(ts.total, 0) > 0
      )
    order by st.code`
}

/**
 * WHAT EACH PERSON OWES TODAY, for a screen rather than a write.
 *
 * `outstandingByStaff` takes a transaction because it is read under the lock a
 * write already holds. This is the same arithmetic for a page, on its own
 * statement — and it returns rupee STRINGS because that is what the payslip
 * sentence formats, and converting twice is where a paisa goes missing.
 *
 * @scope now
 */
export async function outstandingTodayByStaff(
  restaurantId: string,
): Promise<Record<string, string>> {
  const rows = await tsql<{ staff_id: string; owed: string }[]>`
    with advanced as (
      select staff_id, sum(amount) as total from staff_advances
      where restaurant_id = ${restaurantId} group by staff_id
    ),
    recovered as (
      select pl.staff_id, sum(pl.advance_recovered) as total
      from payroll_lines pl
      join payroll_runs r on r.id = pl.run_id
      where r.restaurant_id = ${restaurantId} and r.status <> 'cancelled'
      group by pl.staff_id
    )
    select a.staff_id::text as staff_id,
           greatest(coalesce(a.total, 0) - coalesce(rc.total, 0), 0)::text as owed
    from advanced a
    left join recovered rc on rc.staff_id = a.staff_id`
  return Object.fromEntries(rows.map((r) => [r.staff_id, r.owed]))
}
