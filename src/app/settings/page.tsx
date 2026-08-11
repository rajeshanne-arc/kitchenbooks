// Settings — owner and manager only (the proxy enforces it). Two things
// live here: the seven managed LISTS every categorical field reads
// (LAW 2), and the tab strips' order and labels per role group (LAW 3).
import { getRestaurant } from '@/server/queries'
import { getAllListOptions, getSettingValue } from '@/server/settings'
import { resolveTabs, TAB_GROUPS, type TabDef, type TabGroup } from '@/lib/tabs'
import ListsEditor from '@/components/settings/ListsEditor'
import TabsEditor from '@/components/settings/TabsEditor'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const restaurant = await getRestaurant()
  const options = await getAllListOptions(restaurant.id)
  const tabEntries = await Promise.all(
    TAB_GROUPS.map(async (g) => [g, resolveTabs(g, await getSettingValue(restaurant.id, `tabs.${g}`))] as const),
  )
  const tabs = Object.fromEntries(tabEntries) as Record<TabGroup, TabDef[]>

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className={pageTitleCls}>Settings</h1>
        <p className={pageSubCls}>{restaurant.name} — lists and tab strips</p>
      </header>

      <div className="space-y-8">
        <div>
          <h2 className="mb-3 text-lg font-bold text-stone-900">Lists</h2>
          <p className="mb-3 text-sm text-stone-500">
            Every dropdown in the app reads one of these lists — add here once, and every form offers it. Free text
            survives only in notes and descriptions.
          </p>
          <ListsEditor initialOptions={options} />
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold text-stone-900">Tabs</h2>
          <p className="mb-3 text-sm text-stone-500">
            Each role group&apos;s tab strip — rename or reorder to match how your people work. Defaults return if a
            setting is ever cleared.
          </p>
          <TabsEditor initialTabs={tabs} />
        </div>
      </div>
    </main>
  )
}
