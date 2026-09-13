// WHAT THE OWNER ROUTED TO THE PERSON READING THIS SCREEN.
//
// The mirror of MyQueriesPanel, and built to the same law: it renders NOTHING
// when nothing is waiting. A permanent "Routed to you: 0" is a thing to read
// and dismiss every morning, and absence says the same more quietly.
//
// IT IS THE READER THE BADGE NEEDS. `awaiting_me` counts what is waiting on a
// role and the tab strip sums it; a badge whose destination does not mention
// the thing it counted is the fault this file records for the Setup badge
// sending a manager to Lists to find nothing. So the badge sends them here,
// and here says what it counted.
//
// IT ACTS NOW. The owner's routing screen exists, so this state is reachable
// and the three acts that answer it live here: pay and record, return with a
// reason, challenge with a reason. In step 2 this was read-only and said so —
// a form no state could reach would have been worse than none.
//
// THE READS ARE ORDERED, NOT PARALLEL, and that is not an oversight. Most
// mornings this returns nothing, and the accounts, the modes and the vendor
// details are only wanted when there is something to pay: fetching them first
// would put three queries on every render of two screens to render nothing.
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { getVendorRouting, listAwaiting, type VendorRouting } from '@/server/approvals-queries'
import { getAccountBalances } from '@/server/accounts-queries'
import { businessToday } from '@/server/business-day'
import AwaitingActions from '@/components/approvals/AwaitingActions'

export default async function AwaitingPanel() {
  const user = await getSessionUser()
  if (!user) return null
  const restaurant = await getRestaurant()
  // Payments only. This panel is mounted on payment screens, and an owner
  // standing on one should not be shown a discard request they cannot act on
  // from here — the Approvals page is where those live.
  const rows = (await listAwaiting(restaurant.id, user.role)).filter((r) => r.kind === 'payment')
  if (rows.length === 0) return null

  const [vendorRows, balances, today] = await Promise.all([
    getVendorRouting(restaurant.id, rows.map((r) => r.entity_id)),
    getAccountBalances(restaurant.id),
    businessToday(),
  ])
  const vendors: Record<string, VendorRouting> = Object.fromEntries(vendorRows)

  return <AwaitingActions rows={rows} vendors={vendors} balances={balances} today={today} />
}
