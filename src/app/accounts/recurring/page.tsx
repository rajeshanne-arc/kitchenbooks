import { getRestaurant } from '@/server/queries'
import { listAccountingAccounts } from '@/server/accounting-accounts'
import { listRecurringTemplates } from '@/server/recurring-queries'
import { businessToday } from '@/server/business-day'
import RecurringEntries from '@/components/accountant/RecurringEntries'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'
export default async function RecurringPage() { const restaurant = await getRestaurant(); const [accounts, templates, today] = await Promise.all([listAccountingAccounts(restaurant.id), listRecurringTemplates(restaurant.id), businessToday()]); return <><header className="pb-4"><h1 className={pageTitleCls}>Recurring entries</h1><p className={pageSubCls}>{restaurant.name} — repeatable journal templates with one deliberate post per period.</p></header><RecurringEntries accounts={accounts} initial={templates} today={today} /></> }
