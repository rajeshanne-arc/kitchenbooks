import { getRestaurant } from '@/server/queries'
import { listWithholdings } from '@/server/register-queries'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { businessToday } from '@/server/business-day'
import WithholdingsPanel from '@/components/accountant/WithholdingsPanel'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

// TAX DEPOSITS. Recording what was withheld, and — the part that is a PAYMENT —
// marking it deposited, which names a real account and moves real money today.
//
// It moved off the Tax register for the reason the accounts strip is now split
// on: Registers are for READING and Payments are for WRITING. Mounting the
// panel in both places would have been the second mount of one component,
// which this repo treats as duplication by definition.
//
// RECORD WHAT WAS WITHHELD, NEVER COMPUTE A RATE. TDS here, PAYG withholding
// in Australia, backup withholding in the US — every country has the shape and
// no two agree on rates or thresholds, so `rate_pct` is derived for display
// from the two amounts and is not an input.
export default async function TaxDepositPage() {
  const restaurant = await getRestaurant()
  const [withholdings, accounts, today] = await Promise.all([
    listWithholdings(restaurant.id),
    listMoneyAccounts(restaurant.id),
    businessToday(),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Tax deposit</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what was withheld from a payment, and when it reached the revenue authority
        </p>
      </header>
      <WithholdingsPanel rows={withholdings} today={today} accounts={accounts} />
    </>
  )
}
