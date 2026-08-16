import AttendanceSheet from '@/components/labour/AttendanceSheet'
import { getRestaurant } from '@/server/queries'
import { getDaySheet } from '@/server/labour-queries'
import { pageSubCls, pageTitleCls } from '@/components/ui'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams
  const date = d !== undefined && DATE_RE.test(d) ? d : await businessToday()
  const restaurant = await getRestaurant()
  const sheet = await getDaySheet(restaurant.id, date)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Attendance</h1>
        <p className={pageSubCls}>{restaurant.name} · one sheet per day, corrections stay visible</p>
      </header>
      <AttendanceSheet key={date} date={date} initialSheet={sheet} />
    </>
  )
}
