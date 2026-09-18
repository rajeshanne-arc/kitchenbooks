// LAW 3 — the tab strips. Order, label and hide/show per role group; the KEY
// and the URL are never editable, so a setting can rename a tab and can never
// invent a route. Defaults return if a setting is ever cleared.
import { getRestaurant } from '@/server/queries'
import { getSettingValue } from '@/server/settings'
import { resolveTabs, TAB_GROUPS, type TabDef, type TabGroup } from '@/lib/tabs'
import TabsEditor from '@/components/settings/TabsEditor'
import BusinessDayEditor from '@/components/settings/BusinessDayEditor'
import PurchaseApprovalEditor from '@/components/settings/PurchaseApprovalEditor'
import StockAdjustmentApprovalEditor from '@/components/settings/StockAdjustmentApprovalEditor'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import { pageSubCls, pageTitleCls } from '@/components/ui'
import { hasPetpoojaCredentials } from '@/server/pos-credentials-queries'
import PetpoojaCredentialsEditor from '@/components/settings/PetpoojaCredentialsEditor'
import PosStockPolicyEditor from '@/components/settings/PosStockPolicyEditor'

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
  const [tz, dayStart, approvalMode, approvalThreshold, stockApprovalMode, posStockPolicy, user, petpoojaConfigured] = await Promise.all([
    getSettingValue(restaurant.id, 'timezone'),
    getSettingValue(restaurant.id, 'business_day_start'),
    getSettingValue(restaurant.id, 'purchase_approval_mode'),
    getSettingValue(restaurant.id, 'purchase_approval_threshold'),
    getSettingValue(restaurant.id, 'stock_adjustment_approval_mode'),
    getSettingValue(restaurant.id, 'pos_stock_policy'),
    getSessionUser(),
    hasPetpoojaCredentials(restaurant.id),
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
        {user !== null && user.role === 'owner' && <PetpoojaCredentialsEditor configured={petpoojaConfigured} />}
        {user !== null && user.role === 'owner' && <PosStockPolicyEditor policy={posStockPolicy === 'none' ? 'none' : 'reconcile'} />}
        <BusinessDayEditor
          timezone={tz ?? 'Asia/Kolkata'}
          businessDayStart={dayStart ?? '05:00'}
          canSeeDisagreements={user !== null && canAccess(user.role, '/owner')}
        />
        {user !== null && user.role === 'owner' && (
          <PurchaseApprovalEditor
            mode={approvalMode === 'threshold' ? 'threshold' : 'none'}
            threshold={approvalThreshold ?? '0.00'}
          />
        )}
        {user !== null && user.role === 'owner' && (
          <StockAdjustmentApprovalEditor mode={stockApprovalMode === 'owner' ? 'owner' : 'none'} />
        )}
        <TabsEditor initialTabs={tabs} />
      </div>
    </>
  )
}
