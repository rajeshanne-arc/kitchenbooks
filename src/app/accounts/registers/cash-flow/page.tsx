import { getRestaurant } from '@/server/queries'
import { getCashFlow, getIndirectCashFlow } from '@/server/journal'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import { fmtDate } from '@/lib/format'
import { businessToday } from '@/server/business-day'
import PeriodControl from '@/components/dashboard/PeriodControl'
import { CashFlowStatement, IndirectCashFlowStatement } from '@/components/accountant/AccountingStatement'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'
export default async function CashFlowPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period: raw } = await searchParams; const today = await businessToday(); const req = readPeriodParam(raw, today); const period = resolvePeriod(req.param, today); const restaurant = await getRestaurant(); const [rows, indirect] = await Promise.all([getCashFlow(restaurant.id, period.from, period.to), getIndirectCashFlow(restaurant.id, period.from, period.to)])
  return <><header className="pb-4"><h1 className={pageTitleCls}>Cash flow</h1><p className={pageSubCls}>{restaurant.name} — direct and indirect views, {fmtDate(period.from)} to {fmtDate(period.to)}.</p></header><div className="pb-4"><PeriodControl period={period} today={today} error={req.error} basePath="/accounts/registers/cash-flow" /></div><div className="space-y-4"><CashFlowStatement rows={rows} /><IndirectCashFlowStatement rows={indirect} /></div></>
}
