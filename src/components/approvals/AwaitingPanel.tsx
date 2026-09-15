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
import {
  getVendorRouting,
  listAwaiting,
  listMyOutcomes,
  type VendorRouting,
} from '@/server/approvals-queries'
import MyOutcomes from '@/components/approvals/MyOutcomes'
import { getAccountBalances } from '@/server/accounts-queries'
import { businessToday } from '@/server/business-day'
import type { Role } from '@/lib/roles'
import AwaitingActions from '@/components/approvals/AwaitingActions'

export default async function AwaitingPanel({ role }: { role: Role }) {
  const user = await getSessionUser()
  if (!user) return null
  const restaurant = await getRestaurant()
  // THE ROLE COMES FROM THE SCREEN, NOT FROM THE READER. It used to be
  // `user.role`, which meant an owner opening the accountant's payment screen
  // saw a badge of 2 over an empty page: the badge counts the GROUP's queue
  // and the panel was listing his own. A badge is a claim about a screen.
  //
  // Payments only. A discard waiting on the same role belongs on Approvals,
  // not on a screen for paying vendors.
  const rows = (await listAwaiting(restaurant.id, role)).filter((r) => r.kind === 'payment')
  if (rows.length === 0) return null

  const [vendorRows, balances, today] = await Promise.all([
    getVendorRouting(restaurant.id, rows.map((r) => r.entity_id)),
    getAccountBalances(restaurant.id),
    businessToday(),
  ])
  const vendors: Record<string, VendorRouting> = Object.fromEntries(vendorRows)

  return (
    <AwaitingActions
      rows={rows}
      vendors={vendors}
      balances={balances}
      today={today}
      // "Routed to you" is only true when the reader IS the role the work was
      // routed to. An owner reading the accountant's queue is looking at
      // somebody else's, and the heading says so rather than claiming it.
      mine={user.role === role}
      role={role}
    />
  )
}

/**
 * WHAT CAME BACK TO THE PERSON READING THIS SCREEN.
 *
 * Mounted beside AwaitingPanel and answering the other half of the question:
 * that one is "what is waiting on me", this one is "what happened to what I
 * asked for". They are different queries because they are different questions
 * — one is an obligation, the other is news — and the badge counts only the
 * first.
 *
 * Silent when he has raised nothing that has been decided. A permanent empty
 * card is a thing to read and dismiss every morning.
 */
export async function MyOutcomesPanel() {
  const user = await getSessionUser()
  if (!user) return null
  const restaurant = await getRestaurant()
  const rows = await listMyOutcomes(restaurant.id, user.username)
  if (rows.length === 0) return null
  return <MyOutcomes rows={rows} />
}
