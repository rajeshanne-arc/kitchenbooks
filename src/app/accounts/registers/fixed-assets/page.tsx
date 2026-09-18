import { getRestaurant } from '@/server/queries'
import { listAccountingAccounts } from '@/server/accounting-accounts'
import { listFixedAssets } from '@/server/fixed-asset-queries'
import { businessToday } from '@/server/business-day'
import FixedAssets from '@/components/accountant/FixedAssets'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'
export default async function FixedAssetsPage() { const restaurant = await getRestaurant(); const [accounts, assets, today] = await Promise.all([listAccountingAccounts(restaurant.id), listFixedAssets(restaurant.id), businessToday()]); return <><header className="pb-4"><h1 className={pageTitleCls}>Fixed assets</h1><p className={pageSubCls}>{restaurant.name} — asset register and straight-line depreciation.</p></header><FixedAssets accounts={accounts} initial={assets} today={today} /></> }
