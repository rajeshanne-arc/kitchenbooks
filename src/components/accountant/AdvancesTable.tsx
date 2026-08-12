// Who still owes on an advance, largest first — the order the query already
// returns, kept, because the biggest balance is the one that has to come back.
//
// Name and code only. The read behind this screen carries bank accounts, PAN
// and dates of birth; none of them belong on a screen about money owed.
import type { AdvanceOutstanding } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import {
  dataTableCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export default function AdvancesTable({ rows }: { rows: AdvanceOutstanding[] }) {
  const total = rows.reduce((a, r) => a + decimalStringToPaise(r.outstanding), 0)

  return (
    <div className="overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Person</th>
            <th className={thCls}>Code</th>
            <th className={thCls}>Last advance</th>
            <th className={thNumCls}>Still owed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const owed = decimalStringToPaise(r.outstanding)
            return (
              <tr key={r.staff_id} className={trCls}>
                <td className={`${tdCls} font-medium`}>{r.staff_name}</td>
                <td className={tdCodeCls}>{r.staff_code}</td>
                <td className={`${tdCls} text-stone-500`}>
                  {r.last_advance === null ? (
                    // a balance with no date behind it — say which fact is
                    // missing rather than print a dash that reads as "never"
                    <span className="text-xs text-stone-400">date not recorded</span>
                  ) : (
                    fmtDate(r.last_advance)
                  )}
                </td>
                <td
                  className={`${tdNumCls} font-semibold ${owed < 0 ? 'text-red-700' : 'text-stone-900'}`}
                >
                  {formatMoneyString(r.outstanding)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${tdCls} font-medium text-stone-500`} colSpan={3}>
              {rows.length} {rows.length === 1 ? 'person' : 'people'} carrying a balance
            </td>
            <td className={`${tdNumCls} font-semibold`}>{formatPaise(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
