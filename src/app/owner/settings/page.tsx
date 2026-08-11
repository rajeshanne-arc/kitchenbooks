// LAW 3 — the tab strips. Order, label and hide/show per role group; the KEY
// and the URL are never editable, so a setting can rename a tab and can never
// invent a route. Defaults return if a setting is ever cleared.
import { getRestaurant } from '@/server/queries'
import { getSettingValue } from '@/server/settings'
import { resolveTabs, TAB_GROUPS, type TabDef, type TabGroup } from '@/lib/tabs'
import TabsEditor from '@/components/settings/TabsEditor'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const restaurant = await getRestaurant()
  const tabEntries = await Promise.all(
    TAB_GROUPS.map(async (g) => [g, resolveTabs(g, await getSettingValue(restaurant.id, `tabs.${g}`))] as const),
  )
  const tabs = Object.fromEntries(tabEntries) as Record<TabGroup, TabDef[]>

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Settings</h1>
        <p className={pageSubCls}>
          {restaurant.name} — each group&apos;s tab strip. Rename or reorder to match how your people work; hide what
          this restaurant does not have.
        </p>
      </header>
      <TabsEditor initialTabs={tabs} />
    </>
  )
}
