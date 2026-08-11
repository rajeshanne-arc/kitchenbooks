import { getRestaurant } from '@/server/queries'
import { getFoodCost } from '@/server/kitchen-queries'
import { monthStartIST } from '@/server/store-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { cardCls, sectionHeadCls } from '@/components/ui'
import Honesty, { HonestyPill } from '@/components/Honesty'
import type { FoodCostRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

const monthLabel = (monthStart: string) =>
  new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

const Pending = () => <HonestyPill>pending closing</HonestyPill>

function Row({ r }: { r: FoodCostRow }) {
  const quiet = !r.has_activity
  return (
    <li className={`py-2.5 ${quiet ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[11px] text-stone-400">{r.section_code}</span>
          <span className="truncate text-[15px] text-stone-900">{r.section_name}</span>
        </span>
        <span className="shrink-0 text-right">
          {quiet ? (
            <span className="text-xs text-stone-400">no issues this month</span>
          ) : r.consumed_total === null ? (
            <Pending />
          ) : (
            <span className="text-[15px] font-semibold tabular-nums text-stone-900">
              {formatMoneyString(r.consumed_total)}
              {r.food_cost_pct !== null && (
                <span
                  className={`ml-2 text-sm font-bold ${Number(r.food_cost_pct) > 40 ? 'text-red-700' : 'text-emerald-700'}`}
                >
                  {r.food_cost_pct}%
                </span>
              )}
            </span>
          )}
        </span>
      </div>
      {!quiet && (
        <p className="mt-1 text-xs tabular-nums text-stone-500">
          opening {formatMoneyString(r.opening_value)} + issued {formatMoneyString(r.issued_value)} − closing{' '}
          {r.ending_value !== null ? formatMoneyString(r.ending_value) : '—'}
          {decimalStringToPaise(r.kitchen_wastage) !== 0 && (
            <> · kitchen waste {formatMoneyString(r.kitchen_wastage)}</>
          )}
          {r.sales_value !== null && <> · sales {formatMoneyString(r.sales_value)}</>}
          {r.consumed_total !== null && r.food_cost_pct === null && (
            <span className="text-stone-400"> · no sales mapped, so no %</span>
          )}
        </p>
      )}
    </li>
  )
}

export default async function FoodCostPage() {
  const restaurant = await getRestaurant()
  const monthStart = monthStartIST()
  const rows = await getFoodCost(restaurant.id, monthStart)
  const live = rows.filter((r) => r.has_activity)
  const closed = live.filter((r) => r.consumed_total !== null).length

  return (
    <section className={`${cardCls} mt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>{monthLabel(monthStart)}</h2>
        <span className="text-xs text-stone-400">opening + issued − closing · section_food_cost</span>
      </div>
      {closed < live.length && (
        <div className="mt-3">
          <Honesty
            verdict="incomplete"
            meter={{ filled: closed, total: live.length, unit: 'sections closed' }}
            action={{ href: '/kitchen/closing', label: 'File a closing' }}
          >
            {live.length - closed} of {live.length} sections {live.length - closed === 1 ? 'has' : 'have'} not
            filed a closing for {monthLabel(monthStart)}. Until they do, the consumption below is incomplete —
            not low.
          </Honesty>
        </div>
      )}
      <ul className="mt-2 divide-y divide-rule-soft">
        {rows.map((r) => (
          <Row key={r.section_code} r={r} />
        ))}
      </ul>
      <p className="mt-3 text-xs text-stone-400">
        True consumption only exists once the month has an ending closing — until then it reads “pending closing”,
        never a confident wrong number. Food cost % appears when mapped sales exist. Kitchen waste is shown beside
        the math; it is already inside consumed (it left the section), stated separately so it can be seen.
      </p>
    </section>
  )
}
