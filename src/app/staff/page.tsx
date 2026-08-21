import Link from 'next/link'
import PersonLink from '@/components/labour/PersonLink'
import DateLink from '@/components/dashboard/DateLink'
import { getRestaurant } from '@/server/queries'
import { businessToday } from '@/server/business-day'
import { readPeriodParam, resolvePeriod, monthLabel } from '@/lib/period'
import { attendanceTakenOn, getStaffDashboard } from '@/server/staff-queries'
import { formatMoneyString, decimalStringToPaise, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { requires } from '@/lib/precondition'
import PeriodControl from '@/components/dashboard/PeriodControl'
import PartialMonths from '@/components/dashboard/PartialMonths'
import Unassessed from '@/components/dashboard/Unassessed'
import Honesty from '@/components/Honesty'
import { LabourSplit, MagnitudeBars } from '@/components/dashboard/Charts'
import MyQueriesPanel from '@/components/accountant/MyQueriesPanel'
import {
  cardCls,
  dataTableCls,
  heroNumCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

// THE STAFF DASHBOARD — the group's first tab, and the reason the group is a
// SUBJECT rather than a person.
//
// Staff was "the manager's stuff", which is how Expenses ended up beside
// Attendance. Rent and electricity are overheads on a different P&L line;
// contract bills and casual labour are PEOPLE YOU PAY, and pnl_monthly already
// treats all three kinds as labour. So the subject is people, and this page
// answers about them.
//
// SEVEN CARDS, in the order a manager asks: what are we spending, is it in
// line, where is it going, who is on the roster, who is absent, who owes us
// money, and what do we not know.
//
// PRECONDITIONS THROUGHOUT. Today there is one staff member, no attendance and
// no sales, so six of the seven cannot be assessed — that is the honest state
// and it must read as such. A labour percentage over no revenue is not 0%, it
// is a missing denominator, and saying "0%" would tell a manager their wage
// bill is free.

const sum = (rows: { [k: string]: unknown }[], key: string) =>
  rows.reduce((n, r) => n + Number(r[key] ?? 0), 0)

function Figure({ label, value, tone = 'text-stone-900' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</div>
      <div className={`${heroNumCls} mt-0.5 text-xl ${tone}`}>{value}</div>
    </div>
  )
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

export default async function StaffDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  const restaurant = await getRestaurant()
  const today = await businessToday()
  // Staff was the only group with no period control at all.
  const periodReq = readPeriodParam(periodParam, today)
  const period = resolvePeriod(periodReq.param, today)

  const [d, taken] = await Promise.all([
    getStaffDashboard(restaurant.id, period.months, period.reportMonth),
    attendanceTakenOn(restaurant.id, today),
  ])

  /* ── 1 · what are we spending ─────────────────────────────────────────── */
  const wages = sum(d.labour, 'wages')
  const contract = sum(d.labour, 'contract')
  const casual = sum(d.labour, 'casual')
  const totalLabour = sum(d.labour, 'total_labour')
  const spend = requires(
    d.labour.length > 0,
    { wages, contract, casual, totalLabour },
    'no labour recorded',
    'No attendance has been marked, no contract bill filed and no casual labour recorded in this period, so there is no wage bill to report — not a wage bill of zero.',
  )

  /* ── 2 · is it in line ────────────────────────────────────────────────── */
  // THE DENOMINATOR, not the numerator, is what is missing. Costs are real
  // and revenue is absent, so a percentage would divide by nothing — and a
  // "0%" would read as labour being free.
  const revenue = d.labour.reduce((n, r) => n + Number(r.revenue ?? 0), 0)
  const hasRevenue = d.labour.some((r) => r.revenue !== null && Number(r.revenue) > 0)
  const pct = requires(
    spend.assessable && hasRevenue,
    hasRevenue ? (totalLabour / revenue) * 100 : 0,
    hasRevenue ? 'no labour recorded' : 'no sales fetched',
    hasRevenue
      ? 'There is revenue but no labour recorded, so the ratio has no numerator.'
      : 'No POS day has been fetched for this period, so there is no revenue to measure labour against. The cost is real; the denominator is missing.',
  )

  /* ── 3 · where is it going ────────────────────────────────────────────── */
  const bySection = d.bySection.filter((r) => decimalStringToPaise(r.labour) !== 0)
  const unassignedRow = bySection.find((r) => r.section_code === '—')
  const going = requires(
    bySection.length > 0,
    bySection,
    'no labour by department',
    `Nobody has been marked present in ${monthLabel(period.reportMonth)}, so no wage cost lands on any department.`,
  )

  /* ── 4 · who is on the roster ─────────────────────────────────────────── */
  const heads = d.headcount.reduce((n, r) => n + r.heads, 0)
  const noSalary = d.headcount.reduce((n, r) => n + r.no_salary_set, 0)
  const salaryBill = d.headcount.reduce((n, r) => n + decimalStringToPaise(r.monthly_salary_bill), 0)
  const roster = requires(
    d.headcount.length > 0,
    d.headcount,
    'nobody on the roster',
    'No active staff member is on file, so there is no headcount and no salary bill.',
  )

  /* ── 5 · attendance ───────────────────────────────────────────────────── */
  const absence = requires(
    d.attendance.length > 0,
    d.attendance,
    'no attendance marked',
    'Nobody has been marked present or absent in this period, so there is no pattern to read. An empty attendance log cannot tell a month with no absence from a month nobody took a register.',
  )

  /* ── 6 · money lent ───────────────────────────────────────────────────── */
  const owed = d.advances.reduce((n, r) => n + decimalStringToPaise(r.outstanding), 0)

  /* ── 7 · completeness ─────────────────────────────────────────────────── */
  const unassignedMarks = d.bySection.reduce((n, r) => n + r.unassigned_marks, 0)
  const unsalariedMarks = d.bySection.reduce((n, r) => n + r.unsalaried_marks, 0)
  const complete = unassignedMarks === 0 && unsalariedMarks === 0 && d.unposted.length === 0 && noSalary === 0

  const cannot = [
    !spend.assessable && 'what it spends',
    !pct.assessable && 'whether that is in line',
    !going.assessable && 'where it goes',
    !roster.assessable && 'who is on the roster',
    !absence.assessable && 'the absence pattern',
  ].filter((x): x is string => typeof x === 'string')

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Staff</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what your people cost, who is here, and what is owed
        </p>
      </header>

      <div className="pb-4">
        <PeriodControl period={period} today={today} error={periodReq.error} basePath="/staff" />
      </div>

      <div className="pb-4">
        <MyQueriesPanel />
      </div>

      <PartialMonths period={period} />

      {cannot.length > 0 && (
        <div className="mb-4 mt-4">
          <Unassessed needs={`${cannot.length} of 7 cards cannot be assessed`}>
            Nothing is known yet about {cannot.join(', ')}. Each card says so in its own words rather than
            showing a zero — a zero here would read as a measurement.
          </Unassessed>
        </div>
      )}

      <div className="space-y-4">
        {/* ── 1 ── */}
        <Card title="What are we spending" source="labour_summary">
          {spend.assessable ? (
            <>
              <LabourSplit
                parts={[
                  { label: 'Wages (payroll)', value: spend.data.wages },
                  { label: 'Contract vendors', value: spend.data.contract },
                  { label: 'Casual day hands', value: spend.data.casual },
                ]}
              />
              <p className="mt-2 text-xs text-stone-500">
                All three are labour — the P&amp;L already treats them as one line. A figure counting only
                payroll would miss whatever walks in without a contract.
              </p>
            </>
          ) : (
            <Unassessed needs={spend.needs}>{spend.why}</Unassessed>
          )}
        </Card>

        {/* ── 2 ── */}
        <Card title="Is it in line" source="labour_summary">
          {pct.assessable ? (
            <>
              <Figure
                label={`Labour as a share of sales · ${monthLabel(period.reportMonth)}`}
                value={`${pct.data.toFixed(1)}%`}
                tone={pct.data > 35 ? 'text-red-700' : pct.data > 30 ? 'text-amber-800' : 'text-emerald-800'}
              />
              <p className="mt-2 text-xs text-stone-500">
                A restaurant usually runs 25–35%. Over 35 is coloured, and the number is printed either way —
                the colour agrees with the figure, it does not carry it.
              </p>
            </>
          ) : (
            <Unassessed needs={pct.needs}>{pct.why}</Unassessed>
          )}
        </Card>

        {/* ── 3 ── */}
        <Card title="Where is it going" source="labour_cost_by_section">
          {going.assessable ? (
            <>
              <MagnitudeBars
                rows={going.data.map((r) => ({
                  label: r.section_code === '—' ? 'Unassigned' : r.section_name,
                  value: decimalStringToPaise(r.labour) / 100,
                }))}
              />
              {/* UNASSIGNED IS SHOWN LOUDLY. Those wages belong to a real
                  person who is posted nowhere, so they land on no department
                  and every department's figure is understated by them. */}
              {unassignedRow !== undefined && (
                <div className="mt-3">
                  <Honesty level="alarm" verdict="posted nowhere">
                    {formatMoneyString(unassignedRow.labour)} of wages belongs to somebody with no department,
                    so it lands on none of the bars above and every one of them is short by part of it.
                  </Honesty>
                </div>
              )}
            </>
          ) : (
            <Unassessed needs={going.needs}>{going.why}</Unassessed>
          )}
        </Card>

        {/* ── 4 ── */}
        <Card title="Who is on the roster" source="headcount_by_section">
          {roster.assessable ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Figure label="Heads" value={String(heads)} />
                <Figure label="Monthly salary bill" value={formatPaise(salaryBill)} />
                <Figure
                  label="No salary set"
                  value={String(noSalary)}
                  tone={noSalary > 0 ? 'text-red-700' : 'text-stone-900'}
                />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className={dataTableCls}>
                  <thead>
                    <tr>
                      <th className={thCls}>Department</th>
                      <th className={thCls}>Kind</th>
                      <th className={thNumCls}>Heads</th>
                      <th className={thNumCls}>Salary bill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.data.map((r) => (
                      <tr key={`${r.section_code ?? 'none'}-${r.employment_type}`} className={trCls}>
                        <td className={`${tdCls} font-medium`}>{r.section_name ?? 'Unassigned'}</td>
                        <td className={`${tdCls} text-stone-500`}>{r.employment_type.replace('_', ' ')}</td>
                        <td className={tdNumCls}>{r.heads}</td>
                        <td className={tdNumCls}>{formatMoneyString(r.monthly_salary_bill)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {noSalary > 0 && (
                <div className="mt-3">
                  <Honesty level="alarm" verdict="wage bill understated">
                    {noSalary} {noSalary === 1 ? 'person has' : 'people have'} no salary on file. A person with
                    no salary contributes nothing to labour cost, so every figure on this page is lower than
                    the truth by whatever they are actually paid.
                  </Honesty>
                </div>
              )}
              <p className="mt-2 text-xs text-stone-500">
                A headcount is a fact about now, not about the period above — this table does not move when
                the dates do.
              </p>
            </>
          ) : (
            <Unassessed needs={roster.needs}>{roster.why}</Unassessed>
          )}
        </Card>

        {/* ── 5 ── */}
        <Card title="Attendance" source="attendance_summary">
          {/* TODAY FIRST — the only actionable half. A register nobody took
              is the thing a manager can still fix before the day ends. */}
          <div className="mb-3">
            {taken.active === 0 ? (
              <Unassessed needs="nobody to mark">
                No salaried staff member is on file, so there is no register to take.
              </Unassessed>
            ) : taken.marked === 0 ? (
              <Honesty
                level="alarm"
                verdict="not marked"
                action={{ href: '/staff/people/attendance', label: 'Take the register' }}
              >
                Nobody has been marked for <DateLink date={today} className="font-medium" />. Attendance is what the wage bill is worked out
                from, so an unmarked day pays nobody.
              </Honesty>
            ) : taken.marked < taken.active ? (
              <Honesty
                verdict="partly marked"
                meter={{ filled: taken.marked, total: taken.active, unit: 'marked today' }}
                action={{ href: '/staff/people/attendance', label: 'Finish the register' }}
              >
                {taken.active - taken.marked} of {taken.active} have no mark for{' '}
                <DateLink date={today} className="font-medium" />.
              </Honesty>
            ) : (
              <p className="text-sm text-emerald-800">
                Everyone is marked for <DateLink date={today} className="font-medium" />.
              </p>
            )}
          </div>

          {absence.assessable ? (
            <div className="overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Code</th>
                    <th className={thCls}>Name</th>
                    <th className={thNumCls}>Marked</th>
                    <th className={thNumCls}>Absent</th>
                    <th className={thNumCls}>Absent %</th>
                  </tr>
                </thead>
                <tbody>
                  {absence.data.slice(0, 12).map((r) => {
                    const p = r.absent_pct === null ? null : Number(r.absent_pct)
                    return (
                      <tr key={`${r.staff_id}-${r.month}`} className={trCls}>
                        <td className={tdCodeCls}>{r.code}</td>
                        <td className={`${tdCls} font-medium`}>
                          <PersonLink code={r.code} name={r.name} />
                        </td>
                        <td className={tdNumCls}>{r.days_marked}</td>
                        <td className={tdNumCls}>{r.absent}</td>
                        <td className={tdNumCls}>
                          {p === null ? (
                            <span className="text-stone-300">—</span>
                          ) : (
                            <span className={p >= 20 ? 'font-semibold text-red-700' : ''}>{p.toFixed(1)}%</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-stone-500">
                Ranked by absence, not by name — a roster sorted alphabetically hides the one fact this card
                exists to surface.
              </p>
            </div>
          ) : (
            <Unassessed needs={absence.needs}>{absence.why}</Unassessed>
          )}
        </Card>

        {/* ── 6 ── */}
        <Card title="Money lent" source="advances_outstanding">
          {d.advances.length === 0 ? (
            <p className="text-sm text-stone-700">
              No advance is outstanding. Nothing is owed back.
            </p>
          ) : (
            <>
              <Figure label="Outstanding" value={formatPaise(owed)} tone="text-amber-800" />
              <div className="mt-3 overflow-x-auto">
                <table className={dataTableCls}>
                  <thead>
                    <tr>
                      <th className={thCls}>Code</th>
                      <th className={thCls}>Name</th>
                      <th className={thNumCls}>Given</th>
                      <th className={thNumCls}>Recovered</th>
                      <th className={thNumCls}>Outstanding</th>
                      <th className={thCls}>Last advance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.advances.map((r) => (
                      <tr key={r.staff_id} className={trCls}>
                        <td className={tdCodeCls}>{r.code}</td>
                        <td className={`${tdCls} font-medium`}>
                          <PersonLink code={r.code} name={r.name} />
                        </td>
                        <td className={tdNumCls}>{formatMoneyString(r.given)}</td>
                        <td className={tdNumCls}>{formatMoneyString(r.recovered)}</td>
                        <td className={`${tdNumCls} font-semibold`}>{formatMoneyString(r.outstanding)}</td>
                        <td className={`${tdCls} text-stone-500`}>
                          {r.last_advance === null ? '—' : fmtDate(r.last_advance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                Largest first — money out of the business that nobody is chasing. Advances are recovered on
                the payroll run.
              </p>
            </>
          )}
        </Card>

        {/* ── 7 ── */}
        <Card title="What we do not know" source="labour_cost_by_section · staff">
          {complete ? (
            <p className="text-sm text-stone-700">
              Everyone on the roster has a department and a salary, and every attendance mark counts toward a
              real wage. Nothing here is incomplete.
            </p>
          ) : (
            <div className="space-y-2">
              {d.unposted.length > 0 && (
                <Honesty level="alarm" verdict="posted nowhere">
                  {d.unposted.map((s) => `${s.code} ${s.name}`).join(', ')}{' '}
                  {d.unposted.length === 1 ? 'has' : 'have'} no department. Attendance is taken per
                  department, so {d.unposted.length === 1 ? 'this person' : 'these people'} cannot be filled
                  into a register — and would be paid nothing.
                </Honesty>
              )}
              {unsalariedMarks > 0 && (
                <Honesty verdict="paid marks without a salary">
                  {unsalariedMarks} attendance {unsalariedMarks === 1 ? 'mark counts' : 'marks count'} for
                  somebody with no salary on file, so the wage bill above is lower than the real one.
                </Honesty>
              )}
              {unassignedMarks > 0 && (
                <Honesty level="alarm" verdict="marks with no department">
                  {unassignedMarks} {unassignedMarks === 1 ? 'mark belongs' : 'marks belong'} to staff with no
                  department, so their cost lands on none of the departments above.
                </Honesty>
              )}
              {noSalary > 0 && (
                <Honesty level="alarm" verdict="no salary set">
                  {noSalary} on the roster {noSalary === 1 ? 'has' : 'have'} no salary. Set it on the employee
                  before the next payroll run.
                </Honesty>
              )}
              <Link
                href="/staff/people/employees"
                className="inline-block text-sm font-medium text-emerald-700 hover:underline"
              >
                Employees →
              </Link>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
