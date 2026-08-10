// The owner's P&L — one card per month from pnl_monthly, every line named
// for what it is. sections_pending_closing renders as an honesty banner:
// COGS is understated until every active kitchen closes its month.
// Staff food sits OUTSIDE cogs (a stated policy); giveaway cost is
// informational — that food is already inside consumption.
import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getPnlMonthly } from '@/server/pnl-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { cardCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const monthName = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

function Line({
  label,
  value,
  sign,
  strong,
  muted,
  caption,
}: {
  label: string
  value: string | null
  sign?: '+' | '−'
  strong?: boolean
  muted?: boolean
  caption?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className={`text-sm ${strong ? 'font-semibold text-stone-900' : muted ? 'text-stone-400' : 'text-stone-600'}`}>
        {sign !== undefined && <span className="mr-1 inline-block w-3 text-stone-400">{sign}</span>}
        {label}
        {caption !== undefined && <span className="ml-1.5 text-[11px] font-normal text-stone-400">{caption}</span>}
      </span>
      <span
        className={`shrink-0 tabular-nums ${
          strong ? 'text-[15px] font-bold text-stone-900' : muted ? 'text-sm text-stone-400' : 'text-sm text-stone-800'
        }`}
      >
        {value === null ? 'pending closing' : formatMoneyString(value)}
      </span>
    </div>
  )
}

export default async function PnlPage() {
  const restaurant = await getRestaurant()
  const months = await getPnlMonthly(restaurant.id)

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">P&amp;L</h1>
        <p className="mt-0.5 text-sm text-stone-400">
          {restaurant.name} · month by month · pnl_monthly — every line reads the books, nothing is typed here
        </p>
      </header>

      {months.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
          <p className="text-lg font-semibold text-stone-900">Nothing to add up yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
            The P&amp;L assembles itself from sales, closings, labour and expenses as they are entered.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {months.map((m) => {
            const net = decimalStringToPaise(m.net_before_purch_overheads)
            return (
              <section key={m.month} className={cardCls}>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-lg font-bold text-stone-900">{monthName(m.month)}</h2>
                  <span className={`tabular-nums text-lg font-bold ${net < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {formatMoneyString(m.net_before_purch_overheads)}
                  </span>
                </div>

                {m.sections_pending_closing > 0 && (
                  <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    {m.sections_pending_closing} {m.sections_pending_closing === 1 ? 'section has' : 'sections have'} no
                    ending closing this month — COGS is incomplete and this month is understated. Close them on the
                    Kitchen page.
                  </p>
                )}

                <div className="mt-2 divide-y divide-stone-100">
                  <Line label="POS revenue" value={m.revenue} sign="+" />
                  <Line label="Off-book revenue" value={m.off_book_revenue} sign="+" />
                  <Line label="Other income" value={m.other_income} sign="+" caption="oil, scrap, cartons" />
                  <Line label="COGS (consumed)" value={m.cogs} sign="−" caption="opening + issued − closing" />
                  <Line label="Gross margin" value={m.gross_margin} strong caption="revenue + off-book − COGS" />
                  <Line label="Staff food" value={m.staff_food} sign="−" caption="outside COGS — a stated policy" />
                  <Line label="Labour" value={m.labour} sign="−" />
                  <Line label="Expenses" value={m.expenses} sign="−" caption="non-drawer only" />
                  <Line
                    label="Giveaway cost"
                    value={m.giveaway_cost}
                    muted
                    caption="informational — already inside consumption, not subtracted again"
                  />
                  <Line
                    label="Net before purchase-time overheads"
                    value={m.net_before_purch_overheads}
                    strong
                    caption="not a statutory P&L — GST, depreciation and owner purchases are not in these books yet"
                  />
                </div>
              </section>
            )
          })}
          <p className="text-center text-xs text-stone-400">
            Drill down: <Link href="/expenses" className="text-emerald-700 hover:underline">expenses</Link> ·{' '}
            <Link href="/books/food-cost" className="text-emerald-700 hover:underline">food cost</Link> ·{' '}
            <Link href="/books/sales" className="text-emerald-700 hover:underline">sales</Link> ·{' '}
            <Link href="/books/staff" className="text-emerald-700 hover:underline">labour</Link>
          </p>
        </div>
      )}
    </main>
  )
}
