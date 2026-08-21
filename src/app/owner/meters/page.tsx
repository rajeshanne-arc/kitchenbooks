// METERS — the master, the rate, and the analysis. Owner and accountant.
//
// The accountant is admitted here for the same reason they are admitted to
// /owner/accounts: the rate is the number every estimate turns on, and they
// are the one holding the real bill up against it at month end. There is one
// copy of this screen, not two.
//
// Nothing on this page computes a figure the database does not publish.
// meter_consumption owns the subtraction, the span and the estimate;
// stock_on_hand owns the cylinder arithmetic.
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import {
  getCylinderStock,
  getMeterConsumption,
  getMeteringMode,
  listMeters,
} from '@/server/meters-queries'
import MetersClient from '@/components/meters/MetersClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function MetersPage() {
  const restaurant = await getRestaurant()
  const user = await getSessionUser()
  const [meters, mode, consumption, cylinders] = await Promise.all([
    listMeters(restaurant.id, true),
    getMeteringMode(restaurant.id),
    getMeterConsumption(restaurant.id, 40),
    getCylinderStock(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Meters</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what the utilities cost, read at the day close and estimated until the
          bill arrives.
        </p>
      </header>
      <MetersClient
        initialMeters={meters}
        initialMode={mode}
        consumption={consumption}
        cylinders={cylinders}
        canSetMode={user?.role === 'owner'}
        canEditMeters={user !== null && (user.role === 'owner' || user.role === 'accountant')}
        // A PROP, NEVER A LITERAL: /store/issue is store, manager and owner,
        // so an accountant reading this page must not be shown the door.
        issueHref={user !== null && canAccess(user.role, '/store/issue') ? '/store/issue' : null}
      />
    </>
  )
}
