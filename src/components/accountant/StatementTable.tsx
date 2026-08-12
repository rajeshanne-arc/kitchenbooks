// One vendor's statement: an opening line, every movement in date order, and
// a balance that carries down the column.
//
// The running balance is the only figure on this screen the app works out,
// and it is arithmetic on stated figures — opening, plus each debit, minus
// each credit, in paise so nothing rounds twice. It is NOT an estimate and
// there is no case where it stands in for something missing.
//
// `broughtForward` is handed in already summed, and that matters: it is the
// vendor's opening balance PLUS everything that moved before this period.
// Starting the column at the bare opening balance while showing only one
// month of movements would print a balance that looks authoritative and is
// short by every bill in between.
import type { VendorStatementRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import {
  dataTableCls,
  docNoCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export default function StatementTable({
  rows,
  broughtForward,
  carried,
  from,
}: {
  rows: VendorStatementRow[]
  /** paise: opening balance plus every movement before `from` */
  broughtForward: number
  /** true when movements before `from` exist — the line is worded differently */
  carried: boolean
  from: string
}) {
  // A fold rather than a mutated closure: the running balance is derived
  // from the rows, so it is computed the way derived values are.
  const lines = rows.reduce<
    { r: (typeof rows)[number]; i: number; debit: number; credit: number; balance: number }[]
  >((acc, r, i) => {
    const debit = decimalStringToPaise(r.debit)
    const credit = decimalStringToPaise(r.credit)
    const previous = acc.length === 0 ? broughtForward : acc[acc.length - 1].balance
    acc.push({ r, i, debit, credit, balance: previous + debit - credit })
    return acc
  }, [])
  const running = lines.length === 0 ? broughtForward : lines[lines.length - 1].balance

  const totalDebit = lines.reduce((a, l) => a + l.debit, 0)
  const totalCredit = lines.reduce((a, l) => a + l.credit, 0)

  return (
    <div className="overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Date</th>
            <th className={thCls}>Doc</th>
            <th className={thCls}>Kind</th>
            <th className={thCls}>Narration</th>
            <th className={thNumCls}>Debit</th>
            <th className={thNumCls}>Credit</th>
            <th className={thNumCls}>Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className={trCls}>
            <td className={tdCls}>{fmtDate(from)}</td>
            <td className={tdCls}>
              <span className="text-stone-300">—</span>
            </td>
            <td className={`${tdCls} font-medium`}>{carried ? 'Brought forward' : 'Opening'}</td>
            <td className={`${tdCls} text-stone-500`}>
              {carried
                ? 'opening balance plus everything before this period'
                : 'what they were owed when the vendor was added'}
            </td>
            <td className={tdNumCls} />
            <td className={tdNumCls} />
            <td className={`${tdNumCls} font-semibold`}>{formatPaise(broughtForward)}</td>
          </tr>

          {/* A bill has no credit and a payment has no debit — the view states
              the unused side as 0, and printing "₹0.00" there would claim a
              movement of nothing on every row. The empty cell is the ledger's
              own way of saying "not this side", and it is what the registers
              beside this screen already do. */}
          {lines.map(({ r, i, debit, credit, balance }) => (
            <tr key={`${r.move_date}-${r.doc_no ?? i}-${i}`} className={trCls}>
              <td className={tdCls}>{fmtDate(r.move_date)}</td>
              <td className={tdCls}>
                {r.doc_no === null ? (
                  <span className="text-stone-300">—</span>
                ) : (
                  <span className={docNoCls}>{r.doc_no}</span>
                )}
              </td>
              <td className={tdCls}>{r.kind}</td>
              <td className={`${tdCls} max-w-[16rem] truncate text-stone-500`}>
                {r.narration === '' ? '—' : r.narration}
              </td>
              <td className={tdNumCls}>{debit === 0 ? '' : formatMoneyString(r.debit)}</td>
              <td className={tdNumCls}>{credit === 0 ? '' : formatMoneyString(r.credit)}</td>
              <td className={`${tdNumCls} font-semibold`}>{formatPaise(balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${tdCls} font-medium text-stone-500`} colSpan={4}>
              {rows.length} {rows.length === 1 ? 'movement' : 'movements'} in this period
            </td>
            <td className={`${tdNumCls} font-semibold`}>{formatPaise(totalDebit)}</td>
            <td className={`${tdNumCls} font-semibold`}>{formatPaise(totalCredit)}</td>
            <td className={`${tdNumCls} font-semibold`}>{formatPaise(running)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
