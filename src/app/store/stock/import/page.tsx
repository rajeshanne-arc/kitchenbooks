import { getRestaurant } from '@/server/queries'
import { businessToday } from '@/server/business-day'
import { openingStockImportContract } from '@/server/opening-stock-import'
import OpeningStockImport from '@/components/store/OpeningStockImport'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'
export default async function OpeningStockImportPage() { const restaurant = await getRestaurant(); const today = await businessToday(); return <><header className="pb-4"><h1 className={pageTitleCls}>Opening stock import</h1><p className={pageSubCls}>{restaurant.name} — load an opening count from a validated CSV.</p></header><OpeningStockImport today={today} contract={await openingStockImportContract()} /></> }
