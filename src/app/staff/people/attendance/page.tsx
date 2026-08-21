import AttendanceSheet from '@/components/labour/AttendanceSheet'
import { getRestaurant } from '@/server/queries'
import { getDaySheet } from '@/server/labour-queries'
import { pageSubCls, pageTitleCls } from '@/components/ui'
import PersonLink from '@/components/labour/PersonLink'
import { businessToday } from '@/server/business-day'
import ViewToggle from '@/components/ViewToggle'
import { readView, VIEW_KEYS } from '@/lib/views'
import { getAttendanceOverPeriod } from '@/server/labour-queries'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { cardCls, dataTableCls, sectionHeadCls, tdCls, tdNumCls, thCls, thNumCls, trCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// TWO GRAINS, and the second is a question the first cannot answer however
// many days you page through: "who is absent most". The day sheet is where
// marks are MADE and stays the default; the period view is for reading.
const VIEWS = [
  { value: 'this-day' as const, label: 'This day', hint: 'The sheet — where marks are made, one day at a time.' },
  { value: 'this-period' as const, label: 'This period', hint: 'Who is absent most, ranked by absence rather than by name.' },
]

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; view?: string; period?: string }>
}) {
  const { d, view: viewParam, period: periodParam } = await searchParams
  const view = readView('attendance', viewParam)
  const today = await businessToday()
  const date = d !== undefined && DATE_RE.test(d) ? d : today
  const restaurant = await getRestaurant()
  const period = resolvePeriod(readPeriodParam(periodParam, today).param, today)
  const [sheet, summary] = await Promise.all([
    getDaySheet(restaurant.id, date),
    view === 'this-period' ? getAttendanceOverPeriod(restaurant.id, period.months) : Promise.resolve([]),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Attendance</h1>
        <p className={pageSubCls}>{restaurant.name} · one sheet per day, corrections stay visible</p>
      </header>

      <ViewToggle
        param="view"
        value={view}
        options={VIEWS}
        defaultValue={VIEW_KEYS.attendance[0]}
        label="Which grain of attendance"
      />

      {view === 'this-day' ? (
        <div className="mt-4">
          <AttendanceSheet key={date} date={date} initialSheet={sheet} />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <PeriodControl basePath="/staff/people/attendance" period={period} today={today} />
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={sectionHeadCls}>Absence, worst first</h2>
              <span className="font-mono text-[10px] text-stone-400">attendance_summary</span>
            </div>
            {summary.length === 0 ? (
              <p className="mt-1.5 text-sm text-stone-700">
                Nobody was marked in this period. That is nobody having filled the sheet, not everybody being
                present — an unmarked day is silence, not an absence.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className={dataTableCls}>
                  <thead>
                    <tr>
                      <th className={thCls}>Person</th>
                      <th className={thCls}>Department</th>
                      <th className={thNumCls}>Marked</th>
                      <th className={thNumCls}>Absent</th>
                      <th className={thNumCls}>Leave</th>
                      <th className={thNumCls}>Absent %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((r) => (
                      <tr key={r.staff_id} className={trCls}>
                        <td className={tdCls}>
                          <PersonLink code={r.code} name={r.name} />
                        </td>
                        <td className={`${tdCls} text-stone-500`}>{r.section_name ?? 'unassigned'}</td>
                        <td className={tdNumCls}>{r.days_marked}</td>
                        <td className={`${tdNumCls} ${r.absent > 0 ? 'font-semibold text-red-700' : ''}`}>
                          {r.absent}
                        </td>
                        <td className={tdNumCls}>{r.leave_days}</td>
                        <td className={tdNumCls}>{r.absent_pct === null ? '—' : `${r.absent_pct}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-stone-400">
              Ranked by absence, never by name — a roster in alphabetical order hides the one fact this view
              exists to surface. The percentage is recomputed over the period&apos;s own totals rather than
              averaged across months.
            </p>
          </section>
        </div>
      )}
    </>
  )
}
