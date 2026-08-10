// Server wrapper for a group's tab strip: resolves the signed-in role and
// the settings-driven tab list, then hands the finished strip to the
// client. Pages render <GroupTabs group="kitchen" /> at the top and nothing
// else — LAW 1 and LAW 3 are both decided here, once.
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { tabsFor } from '@/server/settings'
import type { TabGroup } from '@/lib/tabs'
import TabStrip from '@/components/TabStrip'

export default async function GroupTabs({ group }: { group: TabGroup }) {
  const user = await getSessionUser()
  if (!user) return null
  const restaurant = await getRestaurant()
  const tabs = await tabsFor(restaurant.id, group, user.role)
  if (tabs.length === 0) return null
  return <TabStrip tabs={tabs} />
}
