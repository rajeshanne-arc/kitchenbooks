// The FROZEN lines of one run. Nothing here is editable and nothing here is
// recomputed: every figure was worked out when the run was prepared and stored
// then, so a run says next year what it said the day it was approved.
import type { PayrollLineRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import Honesty, { HonestyPill } from '@/components/Honesty'
import {
  dataTableCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

/** the money columns only — the rest of the row is days, names and dates */
type MoneyCol =
  | 'earned'
  | 'overtime'
  | 'advance_recovered'
  | 'other_deduction'
  | 'withholding'
  | 'net_payable'

const sum = (rows: PayrollLineRow[], col: MoneyCol): number =>
  rows.reduce((a, r) => a + decimalStringToPaise(r[col]), 0)

export default function PayrollLinesTable({ lines }: { lines: PayrollLineRow[] }) {
  // A sum over no rows is not a zero, and the footer below would print six of
  // them — six confident ₹0.00 totals for a run nobody is in.
  if (lines.length === 0) {
    return (
      <Honesty level="alarm" verdict="no lines">
        This run holds nobody, so there is nothing here to add up. What is missing is the lines
        themselves, not the money — a run with no people in it is not a run worth ₹0.
      </Honesty>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Code</th>
            <th className={thCls}>Name</th>
            <th className={thCls}>Department</th>
            <th className={thNumCls}>Days</th>
            <th className={thNumCls}>Base</th>
            <th className={thNumCls}>Earned</th>
            <th className={thNumCls}>Overtime</th>
            <th className={thNumCls}>Advance</th>
            <th className={thNumCls}>Other</th>
            <th className={thNumCls}>Withheld</th>
            <th className={thNumCls}>Net</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const net = decimalStringToPaise(l.net_payable)
            return (
              <tr key={l.id} className={trCls}>
                <td className={tdCodeCls}>{l.staff_code}</td>
                <td className={`${tdCls} whitespace-nowrap`}>
                  <span className="flex items-center gap-2">
                    {l.staff_name}
                    {decimalStringToPaise(l.base_salary) === 0 && (
                      <HonestyPill>no salary</HonestyPill>
                    )}
                  </span>
                </td>
                <td className={`${tdCls} whitespace-nowrap text-stone-500`}>
                  {l.section_name ?? <span className="text-stone-300">unassigned</span>}
                </td>
                <td className={`${tdNumCls} whitespace-nowrap text-stone-500`}>
                  {l.days_paid} / {l.days_in_period}
                </td>
                <td className={`${tdNumCls} text-stone-500`}>{formatMoneyString(l.base_salary)}</td>
                <td className={tdNumCls}>{formatMoneyString(l.earned)}</td>
                <td className={tdNumCls}>{formatMoneyString(l.overtime)}</td>
                <td className={tdNumCls}>{formatMoneyString(l.advance_recovered)}</td>
                <td className={tdNumCls}>{formatMoneyString(l.other_deduction)}</td>
                <td className={tdNumCls}>{formatMoneyString(l.withholding)}</td>
                <td
                  className={`${tdNumCls} font-semibold ${net < 0 ? 'text-red-700' : 'text-stone-900'}`}
                >
                  {formatMoneyString(l.net_payable)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${tdCls} font-medium text-stone-500`} colSpan={5}>
              {lines.length} {lines.length === 1 ? 'person' : 'people'}
            </td>
            <td className={`${tdNumCls} font-semibold`}>{formatPaise(sum(lines, 'earned'))}</td>
            <td className={`${tdNumCls} font-semibold`}>{formatPaise(sum(lines, 'overtime'))}</td>
            <td className={`${tdNumCls} font-semibold`}>
              {formatPaise(sum(lines, 'advance_recovered'))}
            </td>
            <td className={`${tdNumCls} font-semibold`}>
              {formatPaise(sum(lines, 'other_deduction'))}
            </td>
            <td className={`${tdNumCls} font-semibold`}>{formatPaise(sum(lines, 'withholding'))}</td>
            <td className={`${tdNumCls} font-semibold`}>{formatPaise(sum(lines, 'net_payable'))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
