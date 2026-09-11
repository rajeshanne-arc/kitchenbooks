import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getSectionCosts } from '@/server/labour-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { cardCls, dataTableCls, sectionHeadCls, tdCls, tdNumCls, thCls, thNumCls } from '@/components/ui'
import { HonestyPill } from '@/components/Honesty'
import type { SectionCostRow } from '@/lib/types'

const monthLabel = (monthStart: string) =>
  new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

/**
 * A NUMBER MUST NEVER BE THE THING THAT GIVES WAY.
 *
 * This was a grid of fixed tracks — `repeat(3,4.9rem)` / `repeat(5,5rem)`, so
 * 78-80px — laid out when the biggest figure here was ₹12,500.00. Ten
 * characters fit. The books now carry ₹25,92,512.00, which is thirteen, and
 * `-₹25,92,512.00` is fourteen: about 105px at 14px tabular digits. The figure
 * overflowed its track and spilled LEFT across the label beside it.
 *
 * INDIAN GROUPING IS WIDER THAN WESTERN AT THE SAME VALUE — ₹1,53,329.89 takes
 * more separators than $153,329.89 — so a layout sized by eye against Western
 * figures runs out sooner here than its author expects.
 *
 * Widening the tracks would only move the threshold, which is the same bug
 * one value later. `max-content` cannot be used either: the header, each row
 * and the totals were SEPARATE grid containers, so content-sized tracks would
 * size independently and stop lining up. A real table sizes columns to content
 * ACROSS rows, which is the property actually wanted — and it is this repo's
 * stated vocabulary for exactly this (`dataTableCls` and friends), inside the
 * one `overflow-x-auto` the layout rules allow a table.
 */
function Money({ v, cls = '' }: { v: string; cls?: string }) {
  const paise = decimalStringToPaise(v)
  return <span className={paise === 0 ? `text-stone-300 ${cls}` : cls}>{formatMoneyString(v)}</span>
}

function Row({ r, loud }: { r: SectionCostRow; loud?: boolean }) {
  const marginNeg = decimalStringToPaise(r.margin) < 0 && decimalStringToPaise(r.sales) !== 0
  const pills = r.unassigned_marks > 0 || r.unsalaried_marks > 0
  const tone = loud ? 'bg-red-50' : ''
  // The honesty pills are a SECOND row spanning every column, so they can be
  // as long as they need to be without widening a numeric column to fit them.
  const cell = pills ? `${tdCls} border-b-0` : tdCls
  const num = pills ? `${tdNumCls} border-b-0` : tdNumCls
  return (
    <>
      <tr className={tone}>
        {/* THE INDEX LINKS TO ITS DETAIL. This screen compares sixteen
            departments; the per-department page answers about one, and the four
            figures here are the only overlap — read from the SAME section_costs
            view, so nothing is computed twice.

            The '—' row is skipped deliberately: it is a synthetic bucket for
            staff posted nowhere, has no `sections` row behind it, and routing to
            /kitchen/departments/— would 404 for a reason nobody could guess. */}
        <td className={cell}>
          <span className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-[11px] text-stone-400">{r.section_code}</span>
            {r.section_code === '—' ? (
              <span className={`truncate ${loud ? 'font-medium text-red-800' : 'text-stone-900'}`}>
                {r.section_name}
              </span>
            ) : (
              <Link
                href={`/kitchen/departments/${r.section_code}`}
                className={`truncate hover:underline ${loud ? 'font-medium text-red-800' : 'text-stone-900'}`}
                title={r.section_name}
              >
                {r.section_name}
              </Link>
            )}
          </span>
        </td>
        <td className={`${num} hidden sm:table-cell`}>
          <Money v={r.consumption} cls="text-stone-600" />
        </td>
        <td className={`${num} hidden sm:table-cell`}>
          <Money v={r.labour} cls="text-stone-600" />
        </td>
        <td className={num}>
          <Money v={r.total_cost} cls="font-semibold text-stone-900" />
        </td>
        <td className={num}>
          <Money v={r.sales} cls="text-stone-900" />
        </td>
        <td className={num}>
          <Money v={r.margin} cls={marginNeg ? 'font-semibold text-red-700' : 'font-semibold text-stone-900'} />
        </td>
      </tr>
      {pills && (
        <tr className={tone}>
          <td className={`${tdCls} pt-0`} colSpan={6}>
            <div className="flex flex-wrap gap-1.5">
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
          </td>
        </tr>
      )}
    </>
  )
}

export default async function SectionsView({ monthStart }: { monthStart: string }) {
  const restaurant = await getRestaurant()
  // section_costs is a join of WHOLE-MONTH aggregates, so this reports the
  // period's last month and the page names it. There is no part-month form of
  // these four figures — the same rule the owner dashboard already follows.
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
      {/* THE ONE overflow-x-auto THE LAYOUT RULES ALLOW A TABLE. On a phone
          six columns of Indian-grouped rupees cannot fit, and the choice is
          between scrolling the table and truncating a figure. A truncated
          figure is a WRONG figure; a truncated label is still findable, and
          the full name is on the link's title. So the table scrolls and the
          page body does not. */}
      <div className="mt-2 -mx-1 overflow-x-auto px-1">
        <table className={dataTableCls}>
          <thead>
            <tr>
              <th className={thCls}>Section</th>
              <th className={`${thNumCls} hidden sm:table-cell`}>Consum.</th>
              <th className={`${thNumCls} hidden sm:table-cell`}>Labour</th>
              <th className={thNumCls}>Cost</th>
              <th className={thNumCls}>Sales</th>
              <th className={thNumCls}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {regular.map((r) => (
              <Row key={r.section_code} r={r} />
            ))}
            {unassigned.map((r) => (
              <Row key="unassigned" r={r} loud />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={`${tdCls} border-b-0 border-t border-stone-200 font-medium text-stone-500`}>Total</td>
              <td className={`${tdNumCls} hidden border-b-0 border-t border-stone-200 font-semibold sm:table-cell`}>
                {formatMoneyString(paise(totals.consumption))}
              </td>
              <td className={`${tdNumCls} hidden border-b-0 border-t border-stone-200 font-semibold sm:table-cell`}>
                {formatMoneyString(paise(totals.labour))}
              </td>
              <td className={`${tdNumCls} border-b-0 border-t border-stone-200 font-bold`}>
                {formatMoneyString(paise(totals.total))}
              </td>
              <td className={`${tdNumCls} border-b-0 border-t border-stone-200 font-bold`}>
                {formatMoneyString(paise(totals.sales))}
              </td>
              <td
                className={`${tdNumCls} border-b-0 border-t border-stone-200 font-bold ${
                  totals.margin < 0 && totals.sales !== 0 ? 'text-red-700' : ''
                }`}
              >
                {formatMoneyString(paise(totals.margin))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-xs text-stone-400">
        Sales arrive from mapped Petpooja lines (latest fetch per day wins); a loud “— / Unmapped” row means money is
        sold that no dish claims — map it under Sales. Labour counts present and off as paid, half as half, and
        excludes contract staff. Cost = consumption + labour on the sm-screen columns.
      </p>
    </section>
  )
}
