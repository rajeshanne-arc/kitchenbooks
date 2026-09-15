// Server wrapper for a group's tab strip: resolves the signed-in role and
// the settings-driven tab list, then hands the finished strip to the
// client. Pages render <GroupTabs group="kitchen" /> at the top and nothing
// else — LAW 1 and LAW 3 are both decided here, once.
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { tabsFor } from '@/server/settings'
import { countOpenIndents, getStockBadge, stockBadgeHref } from '@/server/store-queries'
import { listOpenQueries } from '@/server/accountant-queries'
import { countMissingCloses } from '@/server/cashier-queries'
import { countAwaiting, countWaiting, GROUP_QUEUE_ROLE } from '@/server/approvals-queries'
import { canAccess, type Role } from '@/lib/roles'
import { chipsOf, type TabBadges, type TabGroup, type TabHrefs } from '@/lib/tabs'
import { chipHref } from '@/lib/routes'
import TabStrip from '@/components/TabStrip'

/** Counts that belong on a group's tabs. Server-rendered with the strip
 *  itself, so the number is as fresh as the page and there is no flash of
 *  an empty badge. Only counted for a group that shows them — the kitchen
 *  strip does not pay for a store query. */
async function badgesFor(
  group: TabGroup,
  restaurantId: string,
  role: Role,
): Promise<{ badges: TabBadges; hrefs: TabHrefs }> {
  if (group === 'owner') {
    // THE BADGE MOVED WITH THE PAGE. Approvals is its own tab now, and it
    // counts everything waiting on the owner — requests to decide, words
    // somebody typed, payroll prepared and unapproved. What the badge means is
    // "somebody is waiting on you", which is why three queues make one number:
    // two numbers on one strip would be two things to decode.
    //
    // Setup keeps its own resolution: it is the only chip row in the app that
    // spans a role boundary, so its tab points at the first chip THIS reader
    // can open rather than at a fixed first child that would send a manager to
    // a wall.
    const first = chipsOf('owner', 'setup').find((c) => canAccess(role, `/owner/setup/${c.key}`))
    return {
      badges: canAccess(role, '/owner/approvals')
        ? { approvals: await countWaiting(restaurantId) }
        : {},
      hrefs: first === undefined ? {} : { setup: `/owner/setup/${first.key}` },
    }
  }

  if (group === 'accounts') {
    // Everything unresolved, not just unanswered: an answer the accountant
    // has not read yet is still a question standing between them and a
    // closed month.
    //
    // PAYMENTS COUNTS WHAT WAS FORWARDED TO THEM, from the same awaiting_me
    // the owner's badge sums — one source, two readers, so the two strips
    // cannot come to disagree about what "waiting" means. Its tab opens Pay a
    // vendor rather than the tab's own first chip (Expense), because a badged
    // tab must open the thing it is complaining about.
    const [queries, forwarded] = await Promise.all([
      listOpenQueries(restaurantId),
      countAwaiting(restaurantId, GROUP_QUEUE_ROLE.accounts),
    ])
    return {
      badges: { review: queries.length, payments: forwarded },
      hrefs: forwarded === 0 ? {} : { payments: chipHref('accounts', 'payments', 'pay') },
    }
  }
  if (group === 'sales') {
    // THE BADGE THAT BROUGHT THE TAB BACK. A day with sales and no close is
    // the cashier's one outstanding job, and the chain is hard — no day closes
    // before the one before it — so three unclosed days is three nights of
    // work, not three reminders. A chip could never have said so.
    return { badges: { close: await countMissingCloses(restaurantId) }, hrefs: {} }
  }
  if (group !== 'store') return { badges: {}, hrefs: {} }

  // THE STOCK BADGE COUNTS THREE PROBLEMS, not one. It used to count only
  // reorder, which meant the shelf could read minus four kilos — the app's
  // loudest finding — with nothing on the strip to say so.
  const [stock, issue, routed] = await Promise.all([
    getStockBadge(restaurantId),
    countOpenIndents(restaurantId),
    // A PAYMENT THE OWNER ROUTED BACK TO HIM. Same awaiting_me, same word.
    countAwaiting(restaurantId, GROUP_QUEUE_ROLE.store),
  ])
  const total = stock.negative + stock.unaccepted + stock.reorder
  const target = stockBadgeHref(stock)
  return {
    badges: { stock: total, issue, purchasing: routed },
    // Only when something is firing. With a quiet shelf the tab keeps its own
    // href and opens On hand, which is what Stock means when nothing is wrong.
    hrefs: {
      ...(target === null ? {} : { stock: target }),
      ...(routed === 0 ? {} : { purchasing: chipHref('store', 'purchasing', 'pay') }),
    },
  }
}

export default async function GroupTabs({ group }: { group: TabGroup }) {
  const user = await getSessionUser()
  if (!user) return null
  const restaurant = await getRestaurant()
  const [tabs, { badges, hrefs }] = await Promise.all([
    tabsFor(restaurant.id, group, user.role),
    badgesFor(group, restaurant.id, user.role),
  ])
  if (tabs.length === 0) return null
  return <TabStrip tabs={tabs} badges={badges} hrefs={hrefs} />
}
