// The staff identifier block. It lives under Payroll because it exists for
// payroll: a run that is approved still has to reach somebody's account.
//
// OWNER AND ACCOUNTANT ONLY. The matrix keeps everyone else out of
// /accounts, and updateStaffIdentity re-checks the role anyway — a server
// action is a public endpoint, and the route gate is not the check.
import { getRestaurant } from '@/server/queries'
import { listStaffIdentities } from '@/server/payroll-queries'
import PeopleClient from '@/components/accountant/PeopleClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function PayrollPeoplePage() {
  const restaurant = await getRestaurant()
  const staff = await listStaffIdentities(restaurant.id)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>People</h1>
        <p className={pageSubCls}>
          {restaurant.name} — bank, statutory and personal details, held so that wages can be paid.
        </p>
        <p className="mt-1.5 text-xs text-stone-500">
          Only an owner or the accountant can open this screen: the manager marks attendance and has
          no reason to hold anybody&rsquo;s bank account number or date of birth.
        </p>
      </header>
      <PeopleClient staff={staff} />
    </>
  )
}
