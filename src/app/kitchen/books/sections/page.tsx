import SectionsView from '@/components/views/SectionsView'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

// The SURVIVING mount. SectionsView is a per-department costs report —
// sales, cost, margin — and it was mounted twice, here and under the staff
// Books tab, from one file. Two mounts of one component is duplication by
// definition, so one went; this is not the Departments MASTER, which is a
// different screen with a different job, and dropping both would have
// deleted a report nothing else shows.
//
// The PAGE resolves the period and the view takes a month, so the component
// stays a pure renderer with one caller deciding its scope.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  const today = await businessToday()
  const periodReq = readPeriodParam(periodParam, today)
  const period = resolvePeriod(periodReq.param, today)
  return (
    <>
      <div className="mt-4">
        <PeriodControl
          period={period}
          today={today}
          error={periodReq.error}
          basePath="/kitchen/books/sections"
        />
      </div>
      {/* section_costs answers only in whole months, so the view reports the
          period's last month and names it in its own heading. */}
      <SectionsView monthStart={period.reportMonth} />
    </>
  )
}
