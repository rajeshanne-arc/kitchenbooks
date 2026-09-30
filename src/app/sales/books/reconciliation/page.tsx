import { getRestaurant } from '@/server/queries'
import { listPosStatementComparisons } from '@/server/pos-statement-queries'
import PosStatementReconciliation from '@/components/sales/PosStatementReconciliation'
import { pageSubCls, pageTitleCls } from '@/components/ui'
import WhyNoRange from '@/components/books/WhyNoRange'
export const dynamic = 'force-dynamic'
export default async function PosReconciliationPage() { const restaurant = await getRestaurant(); const rows = await listPosStatementComparisons(restaurant.id); return <><header className="pb-4"><h1 className={pageTitleCls}>POS reconciliation</h1><p className={pageSubCls}>{restaurant.name} — compare provider statement evidence with the latest KitchenBooks sales.</p></header><WhyNoRange why="source" what="This board compares the latest imported provider statement by business date; it is not a reporting-period view." /><PosStatementReconciliation initial={rows} /></> }
