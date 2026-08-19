// LAW 3 — the tab strips. Order, label and hide/show per role group; the KEY
// and the URL are never editable, so a setting can rename a tab and can never
// invent a route. Defaults return if a setting is ever cleared.
import { getRestaurant } from '@/server/queries'
import { getSettingValue } from '@/server/settings'
import { resolveTabs, TAB_GROUPS, type TabDef, type TabGroup } from '@/lib/tabs'
import TabsEditor from '@/components/settings/TabsEditor'
import BusinessDayEditor from '@/components/settings/BusinessDayEditor'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const restaurant = await getRestaurant()
  const tabEntries = await Promise.all(
    TAB_GROUPS.map(async (g) => [g, resolveTabs(g, await getSettingValue(restaurant.id, `tabs.${g}`))] as const),
  )
  const tabs = Object.fromEntries(tabEntries) as Record<TabGroup, TabDef[]>

  // Both have lived in the database with no UI since the business-day
  // migration. Asia/Kolkata is the DEFAULT FOR A NEW TENANT and is written
  // here, once — nothing else in the app may hardcode a zone.
  const [tz, dayStart, user] = await Promise.all([
    getSettingValue(restaurant.id, 'timezone'),
    getSettingValue(restaurant.id, 'business_day_start'),
    getSessionUser(),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Settings</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what a day means here, and each group&apos;s tab strip.
        </p>
      </header>
      <div className="space-y-4">
        <BusinessDayEditor
          timezone={tz ?? 'Asia/Kolkata'}
          businessDayStart={dayStart ?? '05:00'}
          canSeeDisagreements={user !== null && canAccess(user.role, '/owner')}
        />
        <TabsEditor initialTabs={tabs} />
      </div>
    </>
  )
}
