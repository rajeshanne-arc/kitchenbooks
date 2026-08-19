import { getRestaurant } from '@/server/queries'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { listVendorsWithDues } from '@/server/books-queries'
import { getList } from '@/server/settings'
import BankPayment from '@/components/accountant/BankPayment'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

// PAYING A VENDOR FROM HOME. The same recordPayment, the same payments table
// and the same PAY series the store uses at the door — two screens because two
// people are in two places, not because there are two kinds of payment.
//
// It moved here out of Cash & bank, which is a READING screen: balances and
// what has not been reconciled. Writing money out belongs under Payments beside
// the expense and the tax deposit, which is what makes that tab a subject
// rather than a leftovers drawer.
export default async function PayVendorPage() {
  const restaurant = await getRestaurant()
  const [vendors, accounts, modes] = await Promise.all([
    listVendorsWithDues(restaurant.id),
    listMoneyAccounts(restaurant.id),
    getList(restaurant.id, 'payment_mode'),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Pay a vendor</h1>
        <p className={pageSubCls}>
          {restaurant.name} — the transfer you make, against what is owed. The queue is worst first.
        </p>
      </header>
      <BankPayment vendors={vendors} accounts={accounts} modes={modes} />
    </>
  )
}
