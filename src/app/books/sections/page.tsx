import { getRestaurant } from '@/server/queries'
import { monthStartIST } from '@/server/store-queries'
import { getSectionCosts } from '@/server/labour-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { cardCls } from '@/components/ui'
import type { SectionCostRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

const monthLabel = (monthStart: string) =>
  new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

function Row({ r, loud }: { r: SectionCostRow; loud?: boolean }) {
  const zero = decimalStringToPaise(r.total_cost) === 0
  return (
    <li className={`py-2.5 ${loud ? 'rounded-lg border border-red-200 bg-red-50 px-2.5' : ''}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.9rem)] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_repeat(4,5.4rem)]">
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[11px] text-stone-400">{r.section_code}</span>
          <span className={`truncate text-[15px] ${loud ? 'font-medium text-red-800' : 'text-stone-900'}`}>
            {r.section_name}
          </span>
        </span>
        <span className={`text-right text-sm tabular-nums ${zero ? 'text-stone-300' : 'text-stone-600'}`}>
          {formatMoneyString(r.consumption)}
        </span>
        <span className={`text-right text-sm tabular-nums ${zero ? 'text-stone-300' : 'text-stone-600'}`}>
          {formatMoneyString(r.labour)}
        </span>
        <span className={`text-right text-sm font-semibold tabular-nums ${zero ? 'text-stone-300' : 'text-stone-900'}`}>
          {formatMoneyString(r.total_cost)}
        </span>
        <span className="hidden text-right text-sm text-stone-300 sm:block">—</span>
      </div>
      {(r.unassigned_marks > 0 || r.unsalaried_marks > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {r.unassigned_marks > 0 && (
            <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
              {r.unassigned_marks} {r.unassigned_marks === 1 ? 'mark' : 'marks'} from staff with no section
            </span>
          )}
          {r.unsalaried_marks > 0 && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              {r.unsalaried_marks} paid {r.unsalaried_marks === 1 ? 'mark' : 'marks'} without a salary — labour
              understates
            </span>
          )}
        </div>
      )}
    </li>
  )
}

export default async function SectionsPage() {
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
    }),
    { consumption: 0, labour: 0, total: 0 },
  )

  return (
    <section className={`${cardCls} mt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">{monthLabel(monthStart)}</h2>
        <span className="text-xs text-stone-400">consumption + labour · section_costs</span>
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_repeat(3,4.9rem)] gap-2 border-b border-stone-200 pb-1.5 sm:grid-cols-[minmax(0,1fr)_repeat(4,5.4rem)]">
        <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Section</span>
        <span className="text-right text-[11px] font-medium uppercase tracking-wide text-stone-400">Consum.</span>
        <span className="text-right text-[11px] font-medium uppercase tracking-wide text-stone-400">Labour</span>
        <span className="text-right text-[11px] font-medium uppercase tracking-wide text-stone-400">Total</span>
        <span className="hidden text-right text-[11px] font-medium uppercase tracking-wide text-stone-400 sm:block">
          Sales
        </span>
      </div>
      <ul className="divide-y divide-stone-100">
        {regular.map((r) => (
          <Row key={r.section_code} r={r} />
        ))}
        {unassigned.map((r) => (
          <Row key="unassigned" r={r} loud />
        ))}
      </ul>
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.9rem)] gap-2 border-t border-stone-200 pt-2.5 sm:grid-cols-[minmax(0,1fr)_repeat(4,5.4rem)]">
        <span className="text-sm font-medium text-stone-500">Total</span>
        <span className="text-right text-sm font-semibold tabular-nums">
          {formatMoneyString((totals.consumption / 100).toFixed(2))}
        </span>
        <span className="text-right text-sm font-semibold tabular-nums">
          {formatMoneyString((totals.labour / 100).toFixed(2))}
        </span>
        <span className="text-right text-sm font-bold tabular-nums">
          {formatMoneyString((totals.total / 100).toFixed(2))}
        </span>
        <span className="hidden text-right text-sm text-stone-300 sm:block">—</span>
      </div>
      <p className="mt-3 text-xs text-stone-400">
        Sales — arrives with Petpooja sync. Sections with ₹0.00 have simply had nothing this month; labour counts
        present and off as paid, half as half, and excludes contract staff.
      </p>
    </section>
  )
}
