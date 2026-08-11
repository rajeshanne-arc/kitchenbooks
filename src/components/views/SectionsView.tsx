import { getRestaurant } from '@/server/queries'
import { monthStartIST } from '@/server/store-queries'
import { getSectionCosts } from '@/server/labour-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { cardCls, sectionHeadCls } from '@/components/ui'
import { HonestyPill } from '@/components/Honesty'
import type { SectionCostRow } from '@/lib/types'

const monthLabel = (monthStart: string) =>
  new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

const GRID = 'grid-cols-[minmax(0,1fr)_repeat(3,4.9rem)] sm:grid-cols-[minmax(0,1fr)_repeat(5,5rem)]'

function Money({ v, cls = '' }: { v: string; cls?: string }) {
  const paise = decimalStringToPaise(v)
  return (
    <span className={`text-right text-sm tabular-nums ${paise === 0 ? 'text-stone-300' : ''} ${cls}`}>
      {formatMoneyString(v)}
    </span>
  )
}

function Row({ r, loud }: { r: SectionCostRow; loud?: boolean }) {
  const marginNeg = decimalStringToPaise(r.margin) < 0 && decimalStringToPaise(r.sales) !== 0
  return (
    <li className={`py-2.5 ${loud ? 'rounded-lg border border-red-200 bg-red-50 px-2.5' : ''}`}>
      <div className={`grid items-center gap-2 ${GRID}`}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[11px] text-stone-400">{r.section_code}</span>
          <span className={`truncate text-[15px] ${loud ? 'font-medium text-red-800' : 'text-stone-900'}`}>
            {r.section_name}
          </span>
        </span>
        <Money v={r.consumption} cls="hidden text-stone-600 sm:block" />
        <Money v={r.labour} cls="hidden text-stone-600 sm:block" />
        <Money v={r.total_cost} cls="font-semibold text-stone-900" />
        <Money v={r.sales} cls="text-stone-900" />
        <Money v={r.margin} cls={marginNeg ? 'font-semibold text-red-700' : 'font-semibold text-stone-900'} />
      </div>
      {(r.unassigned_marks > 0 || r.unsalaried_marks > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {r.unassigned_marks > 0 && (
            <HonestyPill level="alarm">
              {r.unassigned_marks} {r.unassigned_marks === 1 ? 'mark' : 'marks'} from staff with no section
            </HonestyPill>
          )}
          {r.unsalaried_marks > 0 && (
            <HonestyPill>
              {r.unsalaried_marks} paid {r.unsalaried_marks === 1 ? 'mark' : 'marks'} without a salary — labour
              understates
            </HonestyPill>
          )}
        </div>
      )}
    </li>
  )
}

export default async function SectionsView() {
  const restaurant = await getRestaurant()
  const monthStart = monthStartIST()
  const rows = await getSectionCosts(restaurant.id, monthStart)
  const unassigned = rows.filter((r) => r.section_code === '—')
  const regular = rows.filter((r) => r.section_code !== '—')
  const totals = rows.reduce(
    (acc, r) => ({
      consumption: acc.consumption + decimalStringToPaise(r.consumption),
      labour: acc.labour + decimalStringToPaise(r.labour),
      total: acc.total + decimalStringToPaise(r.total_cost),
      sales: acc.sales + decimalStringToPaise(r.sales),
      margin: acc.margin + decimalStringToPaise(r.margin),
    }),
    { consumption: 0, labour: 0, total: 0, sales: 0, margin: 0 },
  )
  const paise = (n: number) => (n / 100).toFixed(2)

  return (
    <section className={`${cardCls} mt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>{monthLabel(monthStart)}</h2>
        <span className="text-xs text-stone-400">earns, eats, pays · section_costs</span>
      </div>
      <div className={`mt-2 grid gap-2 border-b border-stone-200 pb-1.5 ${GRID}`}>
        <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Section</span>
        <span className="hidden text-right text-[11px] font-medium uppercase tracking-wide text-stone-400 sm:block">
          Consum.
        </span>
        <span className="hidden text-right text-[11px] font-medium uppercase tracking-wide text-stone-400 sm:block">
          Labour
        </span>
        <span className="text-right text-[11px] font-medium uppercase tracking-wide text-stone-400">Cost</span>
        <span className="text-right text-[11px] font-medium uppercase tracking-wide text-stone-400">Sales</span>
        <span className="text-right text-[11px] font-medium uppercase tracking-wide text-stone-400">Margin</span>
      </div>
      <ul className="divide-y divide-rule-soft">
        {regular.map((r) => (
          <Row key={r.section_code} r={r} />
        ))}
        {unassigned.map((r) => (
          <Row key="unassigned" r={r} loud />
        ))}
      </ul>
      <div className={`grid gap-2 border-t border-stone-200 pt-2.5 ${GRID}`}>
        <span className="text-sm font-medium text-stone-500">Total</span>
        <span className="hidden text-right text-sm font-semibold tabular-nums sm:block">
          {formatMoneyString(paise(totals.consumption))}
        </span>
        <span className="hidden text-right text-sm font-semibold tabular-nums sm:block">
          {formatMoneyString(paise(totals.labour))}
        </span>
        <span className="text-right text-sm font-bold tabular-nums">{formatMoneyString(paise(totals.total))}</span>
        <span className="text-right text-sm font-bold tabular-nums">{formatMoneyString(paise(totals.sales))}</span>
        <span
          className={`text-right text-sm font-bold tabular-nums ${totals.margin < 0 && totals.sales !== 0 ? 'text-red-700' : ''}`}
        >
          {formatMoneyString(paise(totals.margin))}
        </span>
      </div>
      <p className="mt-3 text-xs text-stone-400">
        Sales arrive from mapped Petpooja lines (latest fetch per day wins); a loud “— / Unmapped” row means money is
        sold that no dish claims — map it under Sales. Labour counts present and off as paid, half as half, and
        excludes contract staff. Cost = consumption + labour on the sm-screen columns.
      </p>
    </section>
  )
}
