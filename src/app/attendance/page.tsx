import AttendanceSheet from '@/components/labour/AttendanceSheet'
import GroupTabs from '@/components/GroupTabs'
import { getRestaurant } from '@/server/queries'
import { getDaySheet } from '@/server/labour-queries'
import { todayIST } from '@/server/store-queries'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams
  const date = d !== undefined && DATE_RE.test(d) ? d : todayIST()
  const restaurant = await getRestaurant()
  const sheet = await getDaySheet(restaurant.id, date)

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className={pageTitleCls}>Attendance</h1>
        <p className={pageSubCls}>{restaurant.name} · one sheet per day, corrections stay visible</p>
      </header>
      <GroupTabs group="staff" />
      <AttendanceSheet key={date} date={date} initialSheet={sheet} />
    </main>
  )
}
