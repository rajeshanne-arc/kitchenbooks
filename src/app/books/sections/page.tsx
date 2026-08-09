import { getRestaurant } from '@/server/queries'
import { getSectionsWithMonth, monthStartIST } from '@/server/store-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { cardCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const monthLabel = (monthStart: string) =>
  new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

export default async function SectionsPage() {
  const restaurant = await getRestaurant()
  const monthStart = monthStartIST()
  const rows = await getSectionsWithMonth(restaurant.id, monthStart)
  const totalPaise = rows.reduce((a, r) => a + decimalStringToPaise(r.consumed_value), 0)

  return (
    <section className={`${cardCls} mt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">
          Consumed in {monthLabel(monthStart)}
        </h2>
        <span className="text-xs text-stone-400">issues at weighted-average cost · section_consumption</span>
      </div>
      <ul className="mt-1 divide-y divide-stone-100">
        {rows.map((s) => {
          const paise = decimalStringToPaise(s.consumed_value)
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="font-mono text-[11px] text-stone-400">{s.code}</span>
                <span className="truncate text-[15px] text-stone-900">{s.name}</span>
              </span>
              <span
                className={`shrink-0 text-[15px] font-semibold tabular-nums ${
                  paise !== 0 ? 'text-stone-900' : 'text-stone-300'
                }`}
              >
                {formatMoneyString(s.consumed_value)}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center justify-between border-t border-stone-200 pt-3">
        <span className="text-sm font-medium text-stone-500">Total</span>
        <span className="text-xl font-bold tabular-nums tracking-tight text-stone-900">
          {formatMoneyString((totalPaise / 100).toFixed(2))}
        </span>
      </div>
      <p className="mt-3 text-xs text-stone-400">
        Sections with ₹0.00 have simply had nothing issued this month — including Staff Food, until it does.
      </p>
    </section>
  )
}
