import { getRestaurant } from '@/server/queries'
import { listAccountingAccounts } from '@/server/accounting-accounts'
import { listAccruals } from '@/server/accrual-queries'
import { businessToday } from '@/server/business-day'
import Accruals from '@/components/accountant/Accruals'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'
export default async function AccrualsPage() { const restaurant = await getRestaurant(); const [accounts, accruals, today] = await Promise.all([listAccountingAccounts(restaurant.id), listAccruals(restaurant.id), businessToday()]); return <><header className="pb-4"><h1 className={pageTitleCls}>Accruals</h1><p className={pageSubCls}>{restaurant.name} — accrued expense, liability, and controlled reversal.</p></header><Accruals accounts={accounts} initial={accruals} today={today} /></> }
