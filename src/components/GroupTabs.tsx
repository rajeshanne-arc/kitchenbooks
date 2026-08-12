// Server wrapper for a group's tab strip: resolves the signed-in role and
// the settings-driven tab list, then hands the finished strip to the
// client. Pages render <GroupTabs group="kitchen" /> at the top and nothing
// else — LAW 1 and LAW 3 are both decided here, once.
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { tabsFor } from '@/server/settings'
import { countOpenIndents, countReorderDue } from '@/server/store-queries'
import { listOpenQueries } from '@/server/accountant-queries'
import type { TabBadges, TabGroup } from '@/lib/tabs'
import TabStrip from '@/components/TabStrip'

/** Counts that belong on a group's tabs. Server-rendered with the strip
 *  itself, so the number is as fresh as the page and there is no flash of
 *  an empty badge. Only counted for a group that shows them — the kitchen
 *  strip does not pay for a store query. */
async function badgesFor(group: TabGroup, restaurantId: string): Promise<TabBadges> {
  if (group === 'accounts') {
    // Everything unresolved, not just unanswered: an answer the accountant
    // has not read yet is still a question standing between them and a
    // closed month.
    return { review: (await listOpenQueries(restaurantId)).length }
  }
  if (group !== 'store') return {}
  const [reorder, issue] = await Promise.all([
    countReorderDue(restaurantId),
    countOpenIndents(restaurantId),
  ])
  return { reorder, issue }
}

export default async function GroupTabs({ group }: { group: TabGroup }) {
  const user = await getSessionUser()
  if (!user) return null
  const restaurant = await getRestaurant()
  const [tabs, badges] = await Promise.all([
    tabsFor(restaurant.id, group, user.role),
    badgesFor(group, restaurant.id),
  ])
  if (tabs.length === 0) return null
  return <TabStrip tabs={tabs} badges={badges} />
}
