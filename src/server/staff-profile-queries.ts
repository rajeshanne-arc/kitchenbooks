import 'server-only'
import { tsql } from '@/lib/db'
import type {
  AdvanceLedgerRow,
  AdvancesOutstandingRow,
  AttendanceDay,
  AttendanceSummaryRow,
  PayrollHistoryRow,
  StaffRow,
} from '@/lib/types'

// The employee profile's reads. A PERSON is the second real unit of
// accountability in this app — everything about them existed and was
// scattered across four views with no page.
//
// TWO KEYS, exactly as the department page has. `staff` is keyed on the UUID;
// every view here is keyed on `staff_id`, also a UUID — so unlike departments
// there is no code/uuid split INSIDE the data. The code is a URL affordance
// only: it is permanent, human-readable and the thing people say out loud
// ("E014"), so it is what the address bar carries, and it is resolved to the
// id once, here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve by CODE (canonical) or by UUID (what the old edit URL carried, and
 * what a phone may still have bookmarked). Returns the row so the caller can
 * redirect a uuid to its canonical code URL rather than serving two addresses
 * for one person.
 *
 * Case-insensitive on the code: nobody types E014 in caps from a phone.
 */
export async function getStaffByRef(restaurantId: string, ref: string): Promise<StaffRow | null> {
  const rows = await tsql<StaffRow[]>`
    select s.id, s.code, s.name, s.designation, s.section_id,
           sec.code as section_code, sec.name as section_name,
           sec.dept_group, sec.sort_order as section_sort,
           s.grade, s.employment_type, s.base_salary::text as base_salary,
           s.pay_mode, s.joined::text as joined, s.left_date::text as left_date,
           s.reports_to, m.name as reports_to_name, s.phone, s.status,
           s.created_at::text as created_at
    from staff s
    left join sections sec on sec.id = s.section_id
    left join staff m on m.id = s.reports_to
    where s.restaurant_id = ${restaurantId}
      and (${UUID.test(ref) ? ref : null}::uuid is not null and s.id = ${UUID.test(ref) ? ref : null}::uuid
           or lower(s.code) = lower(${ref}))`
  return rows[0] ?? null
}

/** Per month, for the months the period covers. */
export async function getAttendanceSummary(
  restaurantId: string,
  staffId: string,
  months: string[],
): Promise<AttendanceSummaryRow[]> {
  if (months.length === 0) return []
  return tsql<AttendanceSummaryRow[]>`
    select staff_id, code, name, section_code, section_name,
           month::text as month, days_marked::int as days_marked, present::int as present,
           half::int as half, off_days::int as off_days, leave_days::int as leave_days,
           absent::int as absent, absent_pct::text as absent_pct
    from attendance_summary
    where restaurant_id = ${restaurantId} and staff_id = ${staffId}
      and month = any(${months}::date[])
    order by month desc`
}

/**
 * The day-by-day strip. `attendance_current` is the WINNING row per day;
 * `filings` counts every row filed for that day, so a correction stays
 * visible exactly as it does on the sheet — history is never hidden, it is
 * badged.
 */
export async function getAttendanceDays(
  restaurantId: string,
  staffId: string,
  from: string,
  to: string,
): Promise<AttendanceDay[]> {
  return tsql<AttendanceDay[]>`
    select a.att_date::text as att_date, a.status, a.extra_hours::text as extra_hours,
           a.entered_by,
           (select count(*)::int from attendance h
            where h.staff_id = a.staff_id and h.att_date = a.att_date
              and h.restaurant_id = ${restaurantId}) as filings
    from attendance_current a
    where a.restaurant_id = ${restaurantId} and a.staff_id = ${staffId}
      and a.att_date >= ${from}::date and a.att_date <= ${to}::date
    order by a.att_date asc`
}

/**
 * Run by run, most recent first. The view already excludes CANCELLED runs;
 * `status` is carried through because draft, approved and paid are three
 * different claims and only the last one is money that moved.
 */
export async function getPayrollHistory(restaurantId: string, staffId: string): Promise<PayrollHistoryRow[]> {
  return tsql<PayrollHistoryRow[]>`
    select run_id, doc_no, period_start::text as period_start, period_end::text as period_end,
           status, days_in_period::text as days_in_period, days_paid::text as days_paid,
           earned::text as earned, overtime::text as overtime,
           advance_recovered::text as advance_recovered, other_deduction::text as other_deduction,
           withholding::text as withholding, net_payable::text as net_payable,
           paid_on::text as paid_on, pay_mode
    from staff_payroll_history
    where restaurant_id = ${restaurantId} and staff_id = ${staffId}
    order by period_start desc`
}

/** Given, recovered, outstanding. Absent entirely when they have never had one. */
export async function getAdvancesOutstanding(
  restaurantId: string,
  staffId: string,
): Promise<AdvancesOutstandingRow | null> {
  const rows = await tsql<AdvancesOutstandingRow[]>`
    select given::text as given, recovered::text as recovered,
           outstanding::text as outstanding, last_advance::text as last_advance
    from advances_outstanding
    where restaurant_id = ${restaurantId} and staff_id = ${staffId}`
  return rows[0] ?? null
}

/** Every advance ever given them, newest first. Reversals are BADGED rather
 *  than hidden — a correction is a thing somebody filed. */
export async function getAdvanceLedger(restaurantId: string, staffId: string): Promise<AdvanceLedgerRow[]> {
  return tsql<AdvanceLedgerRow[]>`
    select a.id, a.adv_date::text as adv_date, a.amount::text as amount, a.doc_no, a.note,
           a.entered_by, (a.reverses_id is not null) as is_reversal,
           exists (select 1 from staff_advances r where r.reverses_id = a.id) as is_reversed
    from staff_advances a
    where a.restaurant_id = ${restaurantId} and a.staff_id = ${staffId}
    order by a.adv_date desc, a.created_at desc
    limit 40`
}
