// ONE table for all seven registers: date · doc · party · narration · debit
// · credit, with the two columns totalled at the foot.
//
// The shape is not a design choice — it is the shape every accountant on
// earth already reads. The app's contribution is putting the right rows
// under the right word, and naming the view each one came from.
import type { RegisterRow } from '@/lib/types'
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

const sum = (rows: RegisterRow[], col: 'debit' | 'credit'): number =>
  rows.reduce((a, r) => a + (r[col] === null ? 0 : decimalStringToPaise(r[col])), 0)

export default function RegisterTable({ rows }: { rows: RegisterRow[] }) {
  const debit = sum(rows, 'debit')
  const credit = sum(rows, 'credit')

  return (
    <div className="overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Date</th>
            <th className={thCls}>Doc</th>
            <th className={thCls}>Party</th>
            <th className={thCls}>Narration</th>
            <th className={thNumCls}>Debit</th>
            <th className={thNumCls}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.entry_date}-${r.doc_no ?? i}-${i}`} className={trCls}>
              <td className={tdCls}>{fmtDate(r.entry_date)}</td>
              <td className={tdCls}>
                {r.doc_no === null ? (
                  <span className="text-stone-300">—</span>
                ) : (
                  <span className={docNoCls}>{r.doc_no}</span>
                )}
              </td>
              <td className={tdCls}>
                {r.party === '' ? '—' : r.party}
                {r.account_name !== null && (
                  <span className="block text-[11px] text-stone-400">{r.account_name}</span>
                )}
              </td>
              <td className={`${tdCls} max-w-[18rem] truncate text-stone-500`}>{r.narration}</td>
              <td className={tdNumCls}>{r.debit === null ? '' : formatMoneyString(r.debit)}</td>
              <td className={tdNumCls}>{r.credit === null ? '' : formatMoneyString(r.credit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${tdCls} font-medium text-stone-500`} colSpan={4}>
              {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
            </td>
            <td className={`${tdNumCls} font-semibold`}>{debit === 0 ? '' : formatPaise(debit)}</td>
            <td className={`${tdNumCls} font-semibold`}>{credit === 0 ? '' : formatPaise(credit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
