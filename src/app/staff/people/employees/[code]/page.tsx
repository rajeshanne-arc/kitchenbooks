import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { businessToday } from '@/server/business-day'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import {
  getAdvanceLedger,
  getAdvancesOutstanding,
  getAttendanceDays,
  getAttendanceSummary,
  getPayrollHistory,
  getStaffByRef,
} from '@/server/staff-profile-queries'
import { getStaffIdentity } from '@/server/payroll-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import PeriodControl from '@/components/dashboard/PeriodControl'
import Unassessed from '@/components/dashboard/Unassessed'
import Honesty from '@/components/Honesty'
import { RetiredBadge } from '@/components/books/Badges'
import {
  cardCls,
  codeCls,
  dataTableCls,
  heroNumCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import type { AttendanceDay, AttendanceStatus, PayrollHistoryRow, StaffRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

// ONE PERSON, EVERYTHING ALREADY KNOWN ABOUT THEM.
//
// The same shape as the department page and for the same reason: a PERSON is
// the second real unit of accountability in this app, everything about them
// already existed in four views, and there was no page to read them together.
// Rajesh asked for this after using the attendance sheet, which is the right
// signal — the sheet is where you notice a person and have nowhere to go.
//
// THE ORDER IS FIXED, not sorted by urgency: this is a story about one
// subject, read in the order somebody asks — who are they, what do we pay
// them, how to reach them, were they here, what have they been paid, what do
// they owe. A page that reshuffles is a page nobody learns.
//
// PRECONDITIONS ARE THE DESIGN WORK. With two staff and no payroll runs most
// of this page cannot be assessed, and an empty table is a shrug: "no payroll
// run has included this person yet" is a fact. The structural cases are kept
// separate from the merely-empty ones — a CONTRACT staff member can never
// appear on a payroll run, and telling them "no run yet" would imply one is
// coming.

const STATUS_STYLE: Record<AttendanceStatus, { label: string; cls: string; title: string }> = {
  present: { label: 'P', cls: 'border-emerald-700 bg-emerald-700 text-white', title: 'present' },
  half: { label: '½', cls: 'border-amber-500 bg-amber-500 text-white', title: 'half day' },
  off: { label: 'O', cls: 'border-stone-500 bg-stone-500 text-white', title: 'off — paid' },
  leave: { label: 'L', cls: 'border-sky-600 bg-sky-600 text-white', title: 'leave' },
  absent: { label: 'A', cls: 'border-red-600 bg-red-600 text-white', title: 'absent' },
}

const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'draft', cls: 'border-stone-300 bg-stone-100 text-stone-600' },
  approved: { label: 'approved', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  paid: { label: 'paid', cls: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
}

const EMPLOYMENT: Record<string, string> = {
  full_time: 'full time',
  trainee: 'trainee',
  contract: 'contract',
}

function Card({ title, source, children }: { title: string; source: string; children: React.ReactNode }) {
  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>{title}</h2>
        <span className="font-mono text-[11px] text-stone-400">{source}</span>
      </div>
      <div className="mt-2">{children}</div>
    </section>
  )
}

/** This can never apply — as opposed to has not happened yet. A different
 *  sentence and a different weight from `Unassessed`, because nobody owes an
 *  entry and "cannot be assessed" would send somebody looking for one. */
function NotApplicable({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-snug text-stone-500">{children}</p>
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</dt>
      <dd className="mt-0.5 text-[15px] text-stone-900">{value}</dd>
    </div>
  )
}

const or = (v: string | null, fallback = '—') => (v === null || v === '' ? fallback : v)

/**
 * WHAT THE DAY SAYS, IN WORDS. It used to read "19 Aug 2026 — present +2h ·
 * corrected ×1": shorthand a reader has to decode, on the one fact that
 * matters most — somebody worked longer than their day. A tooltip is read
 * once, in passing, by whoever is trying to understand a number; it can
 * afford the extra characters.
 */
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

function dayTitle(date: string, day: AttendanceDay): string {
  const parts = [fmtDate(date), STATUS_STYLE[day.status].title]
  if (day.extra_hours !== null) {
    const h = Number(day.extra_hours)
    parts.push(`worked ${day.extra_hours} extra ${h === 1 ? 'hour' : 'hours'}`)
  }
  if (day.filings > 1) parts.push(`corrected ${times(day.filings - 1)}`)
  return parts.join(' · ')
}

/** The day-by-day strip. A day nobody filed is a BLANK cell, drawn as the
 *  honesty meter's empty cell rather than as an absence — the same law the
 *  sheet states above itself: unmarked is not absent. */
function DayStrip({ days, from, to }: { days: AttendanceDay[]; from: string; to: string }) {
  const byDate = new Map(days.map((d) => [d.att_date, d]))
  const cells: { date: string; day: AttendanceDay | undefined }[] = []
  for (let t = new Date(`${from}T00:00:00Z`); t <= new Date(`${to}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1)) {
    const iso = t.toISOString().slice(0, 10)
    cells.push({ date: iso, day: byDate.get(iso) })
  }
  return (
    <div className="flex flex-wrap gap-1">
      {cells.map(({ date, day }) => {
        const n = Number(date.slice(8, 10))
        if (day === undefined) {
          return (
            <span
              key={date}
              title={`${fmtDate(date)} · nothing filed — a blank is not an absence`}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-dashed border-stone-300 bg-cell text-[10px] tabular-nums text-stone-400"
            >
              {n}
            </span>
          )
        }
        const s = STATUS_STYLE[day.status]
        return (
          <span
            key={date}
            title={dayTitle(date, day)}
            className={`relative flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-semibold ${s.cls}`}
          >
            {s.label}
            {/* a late night, and a correction — both are facts about the day
                that the letter alone cannot carry */}
            {day.extra_hours !== null && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-violet-700" />
            )}
            {day.filings > 1 && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-amber-500" />
            )}
          </span>
        )
      })}
    </div>
  )
}

function PaidTable({ rows }: { rows: PayrollHistoryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Period</th>
            <th className={thNumCls}>Days</th>
            <th className={thNumCls}>Earned</th>
            <th className={thNumCls}>Advance</th>
            <th className={thNumCls}>Net</th>
            <th className={thCls}>State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = RUN_STATUS[r.status] ?? RUN_STATUS.draft
            return (
              <tr key={r.run_id} className={trCls}>
                <td className={tdCls}>
                  <span className="block">{fmtDate(r.period_start)}</span>
                  <span className="block text-[11px] text-stone-400">
                    to {fmtDate(r.period_end)}
                    {r.doc_no !== null && ` · ${r.doc_no}`}
                  </span>
                </td>
                <td className={tdNumCls}>
                  {r.days_paid}
                  <span className="text-stone-400">/{r.days_in_period}</span>
                </td>
                <td className={tdNumCls}>{formatMoneyString(r.earned)}</td>
                <td className={tdNumCls}>
                  {Number(r.advance_recovered) === 0 ? (
                    <span className="text-stone-300">—</span>
                  ) : (
                    `−${formatMoneyString(r.advance_recovered)}`
                  )}
                </td>
                <td className={`${tdNumCls} font-semibold`}>{formatMoneyString(r.net_payable)}</td>
                <td className={tdCls}>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                    {st.label}
                  </span>
                  {r.paid_on !== null && (
                    <span className="ml-1.5 text-[11px] text-stone-400">{fmtDate(r.paid_on)}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Header({ staff }: { staff: StaffRow }) {
  return (
    <header className="pb-4">
      <Link
        href="/staff/people/employees"
        className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800"
      >
        ← Employees
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={codeCls}>{staff.code}</span>
        <h1 className={pageTitleCls}>{staff.name}</h1>
        {staff.status === 'inactive' && <RetiredBadge />}
      </div>
      <p className={pageSubCls}>
        {or(staff.designation, 'no designation')} · {or(staff.section_name, 'no department')}
        {staff.grade !== null && ` · ${staff.grade}`} · {EMPLOYMENT[staff.employment_type] ?? staff.employment_type}
      </p>
    </header>
  )
}

export default async function StaffProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ period?: string }>
}) {
  const { code } = await params
  const restaurant = await getRestaurant()
  const staff = await getStaffByRef(restaurant.id, decodeURIComponent(code))
  if (!staff) notFound()
  // ONE ADDRESS PER PERSON. The code is canonical — permanent, human-readable
  // and the thing people say out loud. The old edit URL carried the uuid and
  // phones may have it bookmarked, so it resolves and then redirects here
  // rather than the app answering to two addresses for one person.
  if (decodeURIComponent(code).toLowerCase() !== staff.code.toLowerCase()) {
    redirect(`/staff/people/employees/${staff.code}`)
  }

  const today = await businessToday()
  const { param, error } = readPeriodParam((await searchParams).period, today)
  const period = resolvePeriod(param, today)

  const user = await getSessionUser()
  // IDENTITY AND BANK: OWNER AND ACCOUNTANT ONLY, gated on the READ. A manager
  // opening this page must not receive an account number or a date of birth
  // over the wire — not merely fail to see it rendered. "No reason to hold it"
  // is the whole of data protection in one sentence.
  const mayHoldIdentity = user?.role === 'owner' || user?.role === 'accountant'
  const mayEdit = user?.role === 'manager' || user?.role === 'owner'

  const [summary, days, payroll, advances, ledger, identity] = await Promise.all([
    getAttendanceSummary(restaurant.id, staff.id, period.months),
    getAttendanceDays(restaurant.id, staff.id, period.from, period.to),
    getPayrollHistory(restaurant.id, staff.id),
    getAdvancesOutstanding(restaurant.id, staff.id),
    getAdvanceLedger(restaurant.id, staff.id),
    mayHoldIdentity ? getStaffIdentity(restaurant.id, staff.id) : Promise.resolve(null),
  ])

  const isContract = staff.employment_type === 'contract'
  const marked = summary.reduce((n, m) => n + m.days_marked, 0)
  const present = summary.reduce((n, m) => n + m.present, 0)
  const half = summary.reduce((n, m) => n + m.half, 0)
  const offDays = summary.reduce((n, m) => n + m.off_days, 0)
  const leaveDays = summary.reduce((n, m) => n + m.leave_days, 0)
  const absent = summary.reduce((n, m) => n + m.absent, 0)
  // Computed over the PERIOD's own totals rather than averaging the monthly
  // percentages, which would weight a three-day month like a thirty-day one.
  const absentPct = marked === 0 ? null : ((absent / marked) * 100).toFixed(1)
  const lateDays = days.filter((d) => d.extra_hours !== null)
  const lateHours = lateDays.reduce((n, d) => n + Number(d.extra_hours), 0)
  const corrected = days.filter((d) => d.filings > 1).length
  const identityFilled =
    identity !== null &&
    [
      identity.bank_name,
      identity.account_no,
      identity.ifsc,
      identity.upi_id,
      identity.pan,
      identity.uan,
      identity.pf_number,
      identity.esic_number,
      identity.dob,
      identity.gender,
      identity.aadhaar,
      identity.address,
    ].some((v) => v !== null && v !== '')

  return (
    <>
      <Header staff={staff} />

      {isContract && (
        <div className="mb-4">
          <Honesty verdict="contract" compact>
            {staff.name} is billed by their vendor, not paid through payroll. They never appear on a payroll run and
            never enter labour cost — their agency&apos;s bill does, on Staff → Contract &amp; casual.
          </Honesty>
        </div>
      )}

      <div className="space-y-4">
        <Card title="Employment" source="staff">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="Joined" value={staff.joined === null ? '—' : fmtDate(staff.joined)} />
            <Field label="Reports to" value={or(staff.reports_to_name)} />
            <Field label="Pay mode" value={staff.pay_mode === 'account' ? 'Into an account' : or(staff.pay_mode)} />
            <Field
              label="Base salary"
              value={
                staff.base_salary === null ? (
                  <span className="text-stone-400">not set</span>
                ) : (
                  <span className={`${heroNumCls} text-lg`}>{formatMoneyString(staff.base_salary)}</span>
                )
              }
            />
          </dl>
          {staff.left_date !== null && (
            <p className="mt-3 text-[13px] text-stone-500">Left {fmtDate(staff.left_date)} — retired, never deleted.</p>
          )}
          {staff.base_salary === null && !isContract && (
            <div className="mt-3">
              <Honesty level="alarm" verdict="no salary" compact>
                They contribute nothing to labour cost, so every wage figure that includes them understates by
                whatever they actually earn — and a payroll run cannot work out what they are owed.
              </Honesty>
            </div>
          )}
          {staff.section_id === null && (
            <div className="mt-2">
              <Honesty level="alarm" verdict="no department" compact>
                Their marks land in the unassigned row rather than against a kitchen, so no department carries their
                cost.
              </Honesty>
            </div>
          )}
        </Card>

        <Card title="Contact" source="staff">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="Phone" value={or(staff.phone, 'none on file')} />
            {/* MANAGER-VISIBLE, deliberately. The person who needs this at
                eleven at night is the one running the shift, so it sits here
                rather than in the owner-only block below. */}
            <Field label="In an emergency" value={or(staff.emergency_name)} />
            <Field label="Their phone" value={or(staff.emergency_phone)} />
            <Field label="Relation" value={or(staff.emergency_relation)} />
          </dl>
          {staff.emergency_phone === null && (
            <div className="mt-3">
              <Honesty verdict="no emergency number" compact>
                There is nobody to call for {staff.name}. This is the one field on the page whose absence is only ever
                discovered at the worst possible moment.
              </Honesty>
            </div>
          )}
        </Card>

        {mayHoldIdentity && (
          <Card title="Identity &amp; bank" source="staff · owner and accountant only">
            {identityFilled ? (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  <Field label="Bank" value={or(identity?.bank_name ?? null)} />
                  <Field label="Account" value={or(identity?.account_no ?? null)} />
                  <Field label="IFSC" value={or(identity?.ifsc ?? null)} />
                  <Field label="UPI" value={or(identity?.upi_id ?? null)} />
                  <Field label="PAN" value={or(identity?.pan ?? null)} />
                  <Field label="UAN" value={or(identity?.uan ?? null)} />
                  <Field label="PF number" value={or(identity?.pf_number ?? null)} />
                  <Field label="ESIC number" value={or(identity?.esic_number ?? null)} />
                  <Field
                    label="Date of birth"
                    value={identity?.dob === null || identity?.dob === undefined ? '—' : fmtDate(identity.dob)}
                  />
                  <Field label="Gender" value={or(identity?.gender ?? null)} />
                  <Field label="Aadhaar" value={or(identity?.aadhaar ?? null)} />
                </dl>
                {identity?.address !== null && identity?.address !== undefined && (
                  <div className="mt-3">
                    <Field label="Address" value={<span className="whitespace-pre-line">{identity.address}</span>} />
                  </div>
                )}
                <p className="mt-3 text-[11px] text-stone-400">
                  Recorded as typed — nothing here is validated, masked or checked against a format, because a
                  checksum would bake one country into a field.
                </p>
              </>
            ) : (
              <Unassessed needs="nothing recorded">
                No bank account, UPI id or statutory number is on file for {staff.name}.
                {staff.pay_mode === 'cash'
                  ? ' They are paid cash in hand, which is an answer rather than a gap.'
                  : ' A payroll run can compute what they are owed and still have nowhere to send it.'}
              </Unassessed>
            )}
          </Card>
        )}

        <div>
          <PeriodControl
            period={period}
            today={today}
            error={error}
            basePath={`/staff/people/employees/${staff.code}`}
          />
        </div>

        <Card title={`Attendance · ${period.label}`} source="attendance_summary · attendance_current">
          {staff.status === 'inactive' && marked === 0 ? (
            <NotApplicable>
              {staff.name} is retired{staff.left_date !== null && ` (left ${fmtDate(staff.left_date)})`}, so no
              attendance is expected for this period. Their earlier months are still on the record — widen the period
              to see them.
            </NotApplicable>
          ) : marked === 0 ? (
            <Unassessed needs="no day marked">
              Nothing has been filed for {staff.name} between {fmtDate(period.from)} and {fmtDate(period.to)}. That is
              not a run of absences: a blank earns nothing exactly as an absence does, but nobody has said they were
              away.
            </Unassessed>
          ) : (
            <>
              {/* EXTRA HOURS BELONGS IN THE ROW. It is a fact about the
                  period exactly like the other six — and it is the only one
                  that costs money nobody has priced, so burying it in prose
                  underneath made the cheapest-looking column the expensive
                  one. */}
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
                <Field label="Marked" value={<span className={`${heroNumCls} text-lg`}>{marked}</span>} />
                <Field label="Present" value={<span className={`${heroNumCls} text-lg`}>{present}</span>} />
                <Field label="Half" value={<span className={`${heroNumCls} text-lg`}>{half}</span>} />
                <Field label="Off" value={<span className={`${heroNumCls} text-lg`}>{offDays}</span>} />
                <Field label="Leave" value={<span className={`${heroNumCls} text-lg`}>{leaveDays}</span>} />
                <Field
                  label="Absent"
                  value={
                    <span className={`${heroNumCls} text-lg ${absent > 0 ? 'text-red-700' : ''}`}>
                      {absent}
                      {absentPct !== null && <span className="ml-1 text-xs font-normal">· {absentPct}%</span>}
                    </span>
                  }
                />
                <Field
                  label="Extra hours"
                  value={
                    lateHours === 0 ? (
                      <span className={`${heroNumCls} text-lg text-stone-300`}>—</span>
                    ) : (
                      // violet, the same ink as the dot on the strip — it is an
                      // identity, not a status: nothing is wrong and nothing is
                      // in doubt, somebody simply worked longer.
                      <span className={`${heroNumCls} text-lg text-violet-800`}>
                        {lateHours}
                        <span className="ml-1 text-xs font-normal text-stone-500">
                          · {lateDays.length} {lateDays.length === 1 ? 'shift' : 'shifts'}
                        </span>
                      </span>
                    )
                  }
                />
              </div>
              <div className="mt-4">
                <DayStrip days={days} from={period.from} to={period.to} />
                <p className="mt-2 text-[11px] text-stone-400">
                  P present · ½ half · O off (paid) · L leave · A absent · dashed = nothing filed
                  {lateDays.length > 0 && ' · violet dot = extra hours'}
                  {corrected > 0 && ' · amber dot = corrected, and the correction is kept'}
                </p>
              </div>
              {lateDays.length > 0 && (
                <p className="mt-2 text-[13px] text-stone-600">
                  Extra hours are recorded and never priced. What overtime is worth is a decision — set by statute,
                  different in every state and different again outside this country — not a calculation this app
                  makes.
                </p>
              )}
              {days.length < marked && (
                <div className="mt-3">
                  <Honesty verdict="wider than the strip" compact>
                    The figures above cover {summary.length} whole {summary.length === 1 ? 'month' : 'months'}; the
                    strip shows only the days inside the period. They will not add up, and that is the period being
                    narrower than a month rather than a discrepancy.
                  </Honesty>
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="Paid" source="staff_payroll_history">
          {isContract ? (
            <NotApplicable>
              A contract worker is never on a payroll run — their vendor bills for them. There is nothing missing
              here and nothing to file.
            </NotApplicable>
          ) : payroll.length === 0 ? (
            <Unassessed needs="no payroll run yet">
              No payroll run has included {staff.name}. Runs are prepared by the accountant and approved by the owner;
              until one exists there is nothing to show, and an empty table would read as a run that paid nothing.
            </Unassessed>
          ) : (
            <>
              <PaidTable rows={payroll} />
              {payroll.some((r) => r.status !== 'paid') && (
                <div className="mt-3">
                  <Honesty verdict="not all paid" compact>
                    {payroll.filter((r) => r.status !== 'paid').length} of these{' '}
                    {payroll.filter((r) => r.status !== 'paid').length === 1 ? 'run is' : 'runs are'} still draft or
                    approved. DRAFT IS NOT MONEY THAT MOVED — only a line with a paid-on date has left an account and
                    reached the wages register.
                  </Honesty>
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="Advances" source="advances_outstanding · staff_advances">
          {advances === null && ledger.length === 0 ? (
            <NotApplicable>
              {staff.name} has never been advanced money against wages. Nothing is outstanding because nothing was
              ever lent — this is an empty ledger, not a missing one.
            </NotApplicable>
          ) : (
            <>
              {advances !== null && (
                <div className="grid grid-cols-3 gap-3">
                  <Field
                    label="Outstanding"
                    value={
                      <span
                        className={`${heroNumCls} text-xl ${
                          Number(advances.outstanding) > 0 ? 'text-red-700' : 'text-stone-900'
                        }`}
                      >
                        {formatMoneyString(advances.outstanding)}
                      </span>
                    }
                  />
                  <Field label="Given" value={formatMoneyString(advances.given)} />
                  <Field label="Recovered" value={formatMoneyString(advances.recovered)} />
                </div>
              )}
              {advances !== null && Number(advances.outstanding) < 0 && (
                <div className="mt-3">
                  <Honesty level="alarm" verdict="over-recovered" compact>
                    More has been recovered than was ever advanced. That is not a credit to them — it is an error in a
                    run, and it needs a look before the next one.
                  </Honesty>
                </div>
              )}
              {ledger.length > 0 && (
                <ul className="mt-3 divide-y divide-rule-soft border-t border-rule-soft">
                  {ledger.map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block text-stone-900">
                          {fmtDate(a.adv_date)}
                          {a.is_reversal && (
                            <span className="ml-1.5 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700">
                              correction
                            </span>
                          )}
                          {a.is_reversed && <span className="ml-1.5 text-[11px] text-stone-400">reversed</span>}
                        </span>
                        {(a.doc_no !== null || a.note !== null) && (
                          <span className="block text-[11px] text-stone-400">
                            {a.doc_no}
                            {a.doc_no !== null && a.note !== null && ' · '}
                            {a.note}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-stone-900">
                        {formatMoneyString(a.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>

        {mayEdit && (
          <Link
            href={`/staff/people/employees/${staff.code}/edit`}
            className="block rounded-xl border border-rule bg-cell py-3 text-center text-[15px] font-medium text-stone-700 hover:border-stone-400"
          >
            Edit {staff.name}&rsquo;s record
          </Link>
        )}
      </div>
    </>
  )
}
