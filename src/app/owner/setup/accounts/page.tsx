// Money accounts — the hinge. Every payment, expense, voucher, receipt and
// bank settlement names one of these, and the app refuses a blank rather
// than defaulting to whichever account happens to be first.
import { getRestaurant } from '@/server/queries'
import { countUnaccountedMovements, getAccountBalances, listMoneyAccounts } from '@/server/accounts-queries'
import AccountsEditor from '@/components/accounts/AccountsEditor'
import Honesty from '@/components/Honesty'
import { pageSubCls, pageTitleCls } from '@/components/ui'
import { listAccountingAccounts } from '@/server/accounting-accounts'
import { listPostingMappings } from '@/server/accounting-mappings'
import AccountingChartEditor from '@/components/accounts/AccountingChartEditor'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  const restaurant = await getRestaurant()
  const [accounts, balances, unaccounted, chart, mappings] = await Promise.all([
    // Retired accounts stay on this screen — this is where they are
    // restored, and their balances are still real money.
    listMoneyAccounts(restaurant.id, true),
    getAccountBalances(restaurant.id),
    countUnaccountedMovements(restaurant.id),
    listAccountingAccounts(restaurant.id),
    listPostingMappings(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Accounts</h1>
        <Link href="/owner/setup/accounts/import" className="mt-2 inline-block rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">Import chart</Link>
        <p className={pageSubCls}>
          {restaurant.name} — where the money actually sits. Every money form asks which one.
        </p>
      </header>

      {unaccounted > 0 && (
        <div className="pb-4">
          <Honesty verdict="account unnamed">
            {unaccounted} money {unaccounted === 1 ? 'movement names' : 'movements name'} no account —
            entries made before accounts existed. They are still counted in the P&amp;L; they simply cannot
            be placed in any one account&apos;s balance, so the balances below are short by that much.
          </Honesty>
        </div>
      )}

      <AccountsEditor initialAccounts={accounts} balances={balances} ledgerAccounts={chart} />
      <AccountingChartEditor initial={chart} mappings={mappings} />
    </>
  )
}
