import { getRestaurant } from '@/server/queries'
import {
  getKitchenSections,
  getLastProductionSet,
  getProductionHistory,
  getProductionVariance,
  listProductions,
} from '@/server/kitchen-queries'
import { getQtySold } from '@/server/sales-queries'
import { getSettingValue } from '@/server/settings'
import { listProducibles } from '@/server/recipes-queries'
import ProductionEntry from '@/components/kitchen/ProductionEntry'
import ProductionList from '@/components/kitchen/ProductionList'
import { pageSubCls, pageTitleCls } from '@/components/ui'
import { businessToday } from '@/server/business-day'
import ProductionVarianceReview from '@/components/kitchen/ProductionVarianceReview'
import PrepDemand from '@/components/kitchen/PrepDemand'

export const dynamic = 'force-dynamic'

export default async function ProductionPage() {
  const restaurant = await getRestaurant()
  const today = await businessToday()
  const [sections, producibles, recent, history, variance, posStockPolicy] = await Promise.all([
    getKitchenSections(restaurant.id),
    listProducibles(restaurant.id),
    listProductions(restaurant.id),
    getProductionHistory(restaurant.id),
    getProductionVariance(restaurant.id, `${today.slice(0, 7)}-01`),
    getSettingValue(restaurant.id, 'pos_stock_policy'),
  ])
  const sold = posStockPolicy === 'none' ? [] : await getQtySold(restaurant.id, `${today.slice(0, 7)}-01`)
  const dishById = new Map(producibles.filter((p) => p.kind === 'dish').map((p) => [p.recipe_id, p]))
  const prepDemand = sold.map((row) => { const dish = dishById.get(row.recipe_id); return dish === undefined ? null : { recipeId: row.recipe_id, code: dish.code, name: dish.name, qty: row.qty_sold, value: row.sales_value } }).filter((row): row is NonNullable<typeof row> => row !== null)

  // REFILL FROM LAST, resolved per department on the server so the chef sees
  // the offer the moment a department is picked rather than after a round
  // trip. One small read per department, and there are nine.
  const lastSets = Object.fromEntries(
    await Promise.all(
      sections.map(async (s) => [s.id, await getLastProductionSet(restaurant.id, s.id)] as const),
    ),
  )

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Production</h1>
        <p className={pageSubCls}>batches recorded, unit cost frozen from the recipe card</p>
      </header>

      <div className="space-y-4">
        <ProductionEntry
          sections={sections}
          producibles={producibles}
          history={history}
          lastSets={lastSets}
        />
        <PrepDemand rows={prepDemand} monthLabel={today.slice(0, 7)} enabled={posStockPolicy !== 'none'} />
        <ProductionList rows={recent} />
        {variance.length > 0 && (
          <section className="rounded-2xl border border-stone-200 bg-white p-4">
            <h2 className="font-display text-lg font-bold text-stone-900">Yield variance this month</h2>
            <p className="mt-1 text-sm text-stone-600">Made plus recorded waste compared with each recipe’s expected output.</p>
            <ul className="mt-3 divide-y divide-rule-soft">
              {variance.map((row) => (
                <li key={row.recipe_code} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{row.recipe_code} · {row.recipe_name}<span className="block text-xs text-stone-500">{row.batches} batches · expected {row.expected_qty} · made {row.made_qty} · waste {row.waste_qty}</span></span>
                  <span className="font-semibold tabular-nums text-stone-900">Δ {row.variance_qty} {row.output_unit}<span className="ml-2 text-xs font-normal text-stone-500">{row.review_status.replace('_', ' ')}</span></span>
                  <ProductionVarianceReview row={row} monthStart={`${today.slice(0, 7)}-01`} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}
