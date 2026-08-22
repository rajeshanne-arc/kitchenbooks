import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import {
  getMappingCoverage,
  listDishOptions,
  listItemOptions,
  listMappings,
  listUnmapped,
} from '@/server/sales-queries'
import { getDishCodingSections } from '@/server/kitchen-queries'
import MappingTable from '@/components/sales/MappingTable'
import ViewToggle from '@/components/ViewToggle'
import { readView, VIEW_KEYS } from '@/lib/views'

export const dynamic = 'force-dynamic'

const VIEWS = [
  { value: 'unmapped' as const, label: 'Unmapped', hint: 'The queue, richest first — the top rows are half the money.' },
  { value: 'mapped' as const, label: 'Mapped', hint: 'What has already been attributed, for reviewing a decision somebody made.' },
]

export default async function MappingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const view = readView('mapping', (await searchParams).view)
  const restaurant = await getRestaurant()
  const user = await getSessionUser()
  // LAW 1. The chef may open this queue and NOT the sales books it sits in,
  // so the way back is theirs only if they can walk it. One source: the
  // matrix, never a role comparison written out here.
  const canGoBack = user !== null && canAccess(user.role, '/sales/books/sales')
  const [unmapped, mapped, dishes, items, sections, coverage] = await Promise.all([
    listUnmapped(restaurant.id),
    listMappings(restaurant.id),
    listDishOptions(restaurant.id),
    // THE THIRD TARGET. A bottled water is bought, stocked, issued and sold —
    // a real cost with no recipe — and without it those goods sit inside
    // ACTUAL consumption and are absent from THEORETICAL, so every Bar
    // variance is wrong by the price of the drinks.
    listItemOptions(restaurant.id),
    // THE DEPARTMENTS THAT SELL. Same list a dish can be coded to — the seven
    // that carry a code — because a POS item lands where a dish would. A
    // department that codes no dishes sells nothing and would be a wrong
    // answer offered as a right one.
    getDishCodingSections(restaurant.id),
    getMappingCoverage(restaurant.id),
  ])

  return (
    <div className="mt-4">
      {canGoBack && (
        <Link
          href="/sales/books/sales"
          className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800"
        >
          ← Sales
        </Link>
      )}
      <p className="mt-3 text-sm text-stone-600">
        Every department view in this app is fed from here — sales by department, food cost, margin, the department
        pages, dish quantities sold. Map the biggest rows first: a handful of them is most of the money.
      </p>
      <ViewToggle
        param="view"
        value={view}
        options={VIEWS}
        defaultValue={VIEW_KEYS.mapping[0]}
        label="Which mappings to show"
      />

      <MappingTable
        view={view}
        unmapped={unmapped}
        mapped={mapped}
        dishes={dishes}
        items={items}
        sections={sections}
        coverage={coverage}
      />
    </div>
  )
}
