import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { listDishCosts, listSubCosts } from '@/server/recipes-queries'
import { getQtySold } from '@/server/sales-queries'
import { listSnapshots } from '@/server/counts-queries'
import { formatMoneyString } from '@/lib/money'
import { RetiredBadge } from '@/components/books/Badges'
import SnapshotButton from '@/components/counts/SnapshotButton'
import { fmtDate } from '@/lib/format'
import { sectionHeadCls } from '@/components/ui'
import { HonestyPill } from '@/components/Honesty'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import ViewToggle from '@/components/ViewToggle'
import { readView, VIEW_KEYS } from '@/lib/views'
import type { DishCostRow } from '@/lib/types'
import { businessMonthStart } from '@/server/business-day'

export const dynamic = 'force-dynamic'

const UncostedPill = ({ n }: { n: number }) => (
  <HonestyPill>
    {n} {n === 1 ? 'ingredient has' : 'ingredients have'} no cost yet — bill first
  </HonestyPill>
)

// TWO TOGGLES, because they answer two independent questions. A chef working
// on gravies wants only gravies (KIND); "what is expensive" is a different
// question from "what is in Chinese" (ORDER). Collapsing them into one control
// would force a choice between them.
const KINDS = [
  { value: 'all' as const, label: 'All', hint: 'Dishes and sub-recipes together.' },
  { value: 'dishes' as const, label: 'Dishes', hint: 'Only what is sold — each coded to a department.' },
  { value: 'subs' as const, label: 'Subs', hint: 'Only what is made in batches and used by other recipes.' },
]
const ORDERS = [
  { value: 'by-section' as const, label: 'By department', hint: 'Grouped the way a kitchen is organised.' },
  { value: 'by-food-cost' as const, label: 'By food cost', hint: 'Dearest first, wherever it lives. Uncosted dishes sort last — zero is a broken link, not a cheap dish.' },
]

/** ONE DISH ROW, rendered grouped by department and flat by food cost. Two
 *  copies would be two places for the next change. `showSection` is the only
 *  difference: inside a department heading it repeats, and in the flat list it
 *  is the context that says which kitchen the expensive dish belongs to. */
function DishLine({
  d,
  sold,
  showSection = false,
}: {
  d: DishCostRow
  sold?: { qty_sold: string }
  showSection?: boolean
}) {
  return (
    <li key={d.recipe_id}>
      <Link
        href={`/kitchen/recipes/${d.recipe_id}`}
        className={`flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-stone-50 ${
          d.status === 'inactive' ? 'opacity-60' : ''
        }`}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-700">
            {d.code}
          </code>
          <span className="truncate text-[15px] font-medium text-stone-900">{d.name}</span>
          {d.status === 'inactive' && <RetiredBadge />}
    {showSection && (
      <span className="text-[11px] text-stone-400">{d.section_name}</span>
    )}
          {sold !== undefined && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] tabular-nums text-stone-500">
              × {sold.qty_sold} this month
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          {d.uncosted_lines > 0 ? (
            <UncostedPill n={d.uncosted_lines} />
          ) : (
            <>
              <span className="block text-[15px] font-semibold tabular-nums text-stone-900">
                {formatMoneyString(d.dish_cost)}
              </span>
              {d.food_cost_pct !== null && (
                <span className="block text-xs tabular-nums text-stone-500">
                  {d.food_cost_pct}% of {formatMoneyString(d.selling_price ?? '0')}
                </span>
              )}
            </>
          )}
        </span>
      </Link>
    </li>
  )
}

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; order?: string }>
}) {
  const sp = await searchParams
  const kind = readView('recipeKind', sp.kind)
  const order = readView('recipeOrder', sp.order)
  const restaurant = await getRestaurant()
  // LAW 1: photographs are owner-only. A chef or manager reading this page
  // must not SEE the section, not merely be refused when they click it.
  const user = await getSessionUser()
  const canPhotograph = user !== null && canAccess(user.role, '/owner/snapshots')
  const [dishes, subs, sold, snapshots] = await Promise.all([
    listDishCosts(restaurant.id, order),
    listSubCosts(restaurant.id),
    getQtySold(restaurant.id, await businessMonthStart()),
    listSnapshots(restaurant.id),
  ])
  const soldByRecipe = new Map(sold.map((s) => [s.recipe_id, s]))

  // Grouped only under by-section: under by-food-cost the whole point is one
  // list that crosses departments, so grouping would undo the ordering.
  const bySection = new Map<string, { name: string; rows: DishCostRow[] }>()
  for (const d of order === 'by-section' ? dishes : []) {
    const g = bySection.get(d.section_code) ?? { name: d.section_name, rows: [] }
    g.rows.push(d)
    bySection.set(d.section_code, g)
  }

  return (
    <section className="mt-4 space-y-5">
      <div className="flex flex-wrap gap-3">
        <Link
          href="/kitchen/recipes/new?kind=dish"
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          ＋ New dish
        </Link>
        <Link
          href="/kitchen/recipes/new?kind=sub"
          className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:border-emerald-400"
        >
          ＋ New sub-recipe
        </Link>
      </div>

      {(dishes.length > 0 || subs.length > 0) && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-1">
          <ViewToggle
            param="kind"
            value={kind}
            options={KINDS}
            defaultValue={VIEW_KEYS.recipeKind[0]}
            label="Which recipes to show"
          />
          {kind !== 'subs' && (
            <ViewToggle
              param="order"
              value={order}
              options={ORDERS}
              defaultValue={VIEW_KEYS.recipeOrder[0]}
              label="How to order the dishes"
            />
          )}
        </div>
      )}

      {dishes.length === 0 && subs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center">
          <p className="text-lg font-semibold text-stone-900">No recipes yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
            Recipes cost themselves live from your purchase bills — build one from items you already buy, and its cost
            moves whenever your rates do. Start with a sub-recipe (a gravy, a dough) or go straight to a dish.
          </p>
        </div>
      ) : (
        <>
          {kind !== 'subs' &&
            order === 'by-food-cost' && (
              <div>
                <h2 className={sectionHeadCls}>Dearest first</h2>
                <ul className="mt-1 divide-y divide-rule-soft">
                  {dishes.map((d) => (
                    <DishLine key={d.recipe_id} d={d} sold={soldByRecipe.get(d.recipe_id)} showSection />
                  ))}
                </ul>
              </div>
            )}
          {kind !== 'subs' &&
            order === 'by-section' &&
            [...bySection.entries()].map(([code, group]) => (
            <div key={code}>
              <h2 className={sectionHeadCls}>
                {group.name} <span className="ml-1 font-mono text-[11px] text-stone-400">{code}</span>
              </h2>
              <ul className="mt-1 divide-y divide-rule-soft">
                {group.rows.map((d) => (
                  <DishLine key={d.recipe_id} d={d} sold={soldByRecipe.get(d.recipe_id)} />
                ))}
              </ul>
            </div>
          ))}

          {kind !== 'dishes' && subs.length > 0 && (
            <div>
              <h2 className={sectionHeadCls}>Sub-recipes</h2>
              <ul className="mt-1 divide-y divide-rule-soft">
                {subs.map((s) => (
                  <li key={s.recipe_id}>
                    <Link
                      href={`/kitchen/recipes/${s.recipe_id}`}
                      className={`flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-stone-50 ${
                        s.status === 'inactive' ? 'opacity-60' : ''
                      }`}
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-700">
                          {s.code}
                        </code>
                        <span className="truncate text-[15px] font-medium text-stone-900">{s.name}</span>
                        {s.status === 'inactive' && <RetiredBadge />}
                        <span className="text-xs text-stone-400">
                          makes {s.output_qty} {s.output_unit}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {s.uncosted_lines > 0 ? (
                          <UncostedPill n={s.uncosted_lines} />
                        ) : (
                          <>
                            <span className="block text-[15px] font-semibold tabular-nums text-stone-900">
                              {formatMoneyString(s.cost_per_output_unit)}
                              <span className="font-normal text-stone-400"> / {s.output_unit}</span>
                            </span>
                            <span className="block text-xs tabular-nums text-stone-500">
                              batch {formatMoneyString(s.total_cost)}
                            </span>
                          </>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {canPhotograph && (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={sectionHeadCls}>Photographs</h2>
          <SnapshotButton />
        </div>
        {snapshots.length === 0 ? (
          <p className="mt-1 text-sm text-stone-500">
            None yet. Live costs rewrite history — a month-end photograph keeps what the menu cost that day.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-rule-soft">
            {snapshots.map((s) => (
              <li key={s.snap_date}>
                <Link
                  href={`/owner/snapshots/${s.snap_date}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-stone-50"
                >
                  <span className="text-[15px] font-medium text-stone-900">{fmtDate(s.snap_date)}</span>
                  <span className="text-xs text-stone-500">
                    {s.dishes} {s.dishes === 1 ? 'dish' : 'dishes'} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      <p className="text-xs text-stone-400">
        Costed live at today’s weighted-average purchase costs · recipe_costs / dish_costs. No re-cost button exists —
        none is needed. Photographs freeze a month-end copy in dish_cost_snapshots.
      </p>
    </section>
  )
}
