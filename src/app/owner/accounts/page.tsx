// Money accounts — the hinge. Every payment, expense, voucher, receipt and
// bank settlement names one of these, and the app refuses a blank rather
// than defaulting to whichever account happens to be first.
import { getRestaurant } from '@/server/queries'
import { countUnaccountedMovements, getAccountBalances, listMoneyAccounts } from '@/server/accounts-queries'
import AccountsEditor from '@/components/accounts/AccountsEditor'
import Honesty from '@/components/Honesty'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  const restaurant = await getRestaurant()
  const [accounts, balances, unaccounted] = await Promise.all([
    // Retired accounts stay on this screen — this is where they are
    // restored, and their balances are still real money.
    listMoneyAccounts(restaurant.id, true),
    getAccountBalances(restaurant.id),
    countUnaccountedMovements(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Accounts</h1>
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

      <AccountsEditor initialAccounts={accounts} balances={balances} />
    </>
  )
}
