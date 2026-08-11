import { getRestaurant } from '@/server/queries'
import { getPnlDiagnostics, getPnlMonthly } from '@/server/pnl-queries'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { monthLabel } from '@/lib/period'
import {
  cardCls,
  dataTableCls,
  heroNumCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import Honesty from '@/components/Honesty'

export const dynamic = 'force-dynamic'

// pnl_monthly, rendered verbatim. The view owns every figure; this page adds
// only the arithmetic of stacking them, and says out loud where a number is
// missing rather than printing a confident zero.
//
// cogs is NULL — not zero — until the month has ending closings. A NULL cogs
// makes the net line unstatable, and the page says so instead of subtracting
// nothing and calling the result profit.

const p = (s: string | null) => (s === null ? null : decimalStringToPaise(s))

function Money({ value, bold = false }: { value: string | null; bold?: boolean }) {
  if (value === null) return <span className="text-stone-400">—</span>
  return <span className={bold ? 'font-semibold' : ''}>{formatMoneyString(value)}</span>
}

export default async function PnlPage() {
  const restaurant = await getRestaurant()
  const [rows, diagnostics] = await Promise.all([
    getPnlMonthly(restaurant.id),
    getPnlDiagnostics(restaurant.id),
  ])

  const latest = rows[0] ?? null
  const latestDiag = latest === null ? [] : diagnostics.filter((d) => d.month === latest.month)

  // Stated only when cogs is stated. Everything else is additive.
  const netOf = (r: PnlRowLike): number | null => {
    const cogs = p(r.cogs)
    if (cogs === null) return null
    return (
      decimalStringToPaise(r.net_sales) +
      decimalStringToPaise(r.other_income) -
      cogs -
      decimalStringToPaise(r.total_labour) -
      decimalStringToPaise(r.total_expenses)
    )
  }

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>P&amp;L</h1>
        <p className={pageSubCls}>{restaurant.name} — pnl_monthly, month by month</p>
      </header>

      {rows.length === 0 ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>No months yet</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            The P&amp;L starts once a month has bills, sales or wages against it.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {latest !== null && (
            <section className={cardCls}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className={sectionHeadCls}>{monthLabel(latest.month)}</h2>
                <span className="font-mono text-[10px] text-stone-400">pnl_monthly</span>
              </div>
              {(() => {
                const net = netOf(latest)
                return (
                  <>
                    <p className={`mt-1 text-[32px] ${heroNumCls} ${net === null ? 'text-stone-400' : net < 0 ? 'text-red-700' : 'text-stone-900'}`}>
                      {net === null ? 'not stated' : formatPaise(net)}
                    </p>
                    <p className="text-xs text-stone-500">
                      net sales {formatMoneyString(latest.net_sales)} + other income{' '}
                      {formatMoneyString(latest.other_income)} − cogs{' '}
                      {latest.cogs === null ? '(pending)' : formatMoneyString(latest.cogs)} − labour{' '}
                      {formatMoneyString(latest.total_labour)} − expenses{' '}
                      {formatMoneyString(latest.total_expenses)}
                    </p>
                    {latest.cogs === null && (
                      <div className="mt-2">
                        <Honesty verdict="cogs pending" compact>
                          Cost of goods cannot be stated until the month has its ending closings, so the net line
                          stays blank rather than counting the whole store as consumed.
                        </Honesty>
                      </div>
                    )}
                  </>
                )
              })()}
              {latestDiag.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-rule-soft pt-2">
                  {latestDiag.map((d, i) => (
                    <li key={`${d.severity}-${i}`} className="text-xs">
                      <span
                        className={`mr-1.5 rounded-full px-1.5 py-0.5 font-medium ${
                          d.severity === 'error'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {d.severity}
                      </span>
                      <span className="text-stone-700">{d.what}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className={cardCls}>
            <h2 className={sectionHeadCls}>Month by month</h2>
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Month</th>
                    <th className={thNumCls}>Food &amp; bev</th>
                    <th className={thNumCls}>Off-book</th>
                    <th className={thNumCls}>Net sales</th>
                    <th className={thNumCls}>Purchases</th>
                    <th className={thNumCls}>COGS</th>
                    <th className={thNumCls}>Staff food</th>
                    <th className={thNumCls}>Labour</th>
                    <th className={thNumCls}>Expenses</th>
                    <th className={thNumCls}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const net = netOf(r)
                    return (
                      <tr key={r.month} className={trCls}>
                        <td className={tdCls}>{monthLabel(r.month)}</td>
                        <td className={tdNumCls}>
                          <Money value={r.food_beverage} />
                        </td>
                        <td className={tdNumCls}>
                          <Money value={r.off_book} />
                        </td>
                        <td className={tdNumCls}>
                          <Money value={r.net_sales} bold />
                        </td>
                        <td className={tdNumCls}>
                          <Money value={r.purchases} />
                        </td>
                        <td className={tdNumCls}>
                          <Money value={r.cogs} />
                        </td>
                        <td className={tdNumCls}>
                          <Money value={r.staff_food} />
                        </td>
                        <td className={tdNumCls}>
                          <Money value={r.total_labour} />
                        </td>
                        <td className={tdNumCls}>
                          <Money value={r.total_expenses} />
                        </td>
                        <td
                          className={`${tdNumCls} font-semibold ${
                            net === null ? 'text-stone-400' : net < 0 ? 'text-red-700' : 'text-stone-900'
                          }`}
                        >
                          {net === null ? '—' : formatPaise(net)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-stone-500">
              Staff food is its own line, OUTSIDE cost of goods — it is fed to the staff, not sold. A dash means
              the view could not state that figure, never that it is zero.
            </p>
            <p className="mt-1 text-xs text-stone-500">
              <span className="font-medium">Purchases</span> includes cash vouchers marked as stock — a market
              run paid from the drawer. Those reach cost of goods but never become inventory: no vendor, no
              item lines, so they are absent from stock on hand and from reorder.{' '}
              <span className="font-medium">Labour</span> likewise includes vouchers marked as a day
              hand&apos;s wages.
            </p>
            <p className="mt-1 text-xs text-stone-400">
              Net is before purchase-time overheads — not a statutory P&amp;L.
            </p>
          </section>
        </div>
      )}
    </>
  )
}

type PnlRowLike = {
  net_sales: string
  other_income: string
  cogs: string | null
  total_labour: string
  total_expenses: string
}
