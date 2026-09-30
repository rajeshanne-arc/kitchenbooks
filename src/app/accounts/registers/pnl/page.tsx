import { getRestaurant } from '@/server/queries'
import { getProfitAndLoss } from '@/server/journal'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import { fmtDate } from '@/lib/format'
import { businessToday } from '@/server/business-day'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { AccountingStatement } from '@/components/accountant/AccountingStatement'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'
export default async function PnlPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period: raw } = await searchParams; const today = await businessToday(); const req = readPeriodParam(raw, today); const period = resolvePeriod(req.param, today); const restaurant = await getRestaurant(); const rows = await getProfitAndLoss(restaurant.id, period.from, period.to)
  return <><header className="pb-4"><h1 className={pageTitleCls}>Profit & loss</h1><p className={pageSubCls}>{restaurant.name} — posted journal basis, {fmtDate(period.from)} to {fmtDate(period.to)}.</p></header><div className="pb-4"><PeriodControl period={period} today={today} error={req.error} basePath="/accounts/registers/pnl" /></div><AccountingStatement rows={rows} title="Revenue and expenses" /></>
}
