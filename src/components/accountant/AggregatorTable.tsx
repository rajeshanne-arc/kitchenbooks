// What the delivery partners owe us.
//
// The view LEFT JOINs from the partner master, so a partner who has never
// settled anything still gets a row — "we have never reconciled this one" is
// a finding, and an absent row cannot say it.
//
// Two things this table refuses to smooth over:
//   · agreed_commission_pct is nullable. Without it there is nothing to check
//     what they actually kept against, so the cell says so rather than going
//     blank or filling in a market rate.
//   · gross_billed comes from the POS orders on that partner's channel. When
//     no orders have been fetched it is zero, and "outstanding" then reads as
//     if they had overpaid us. The row says nothing was billed instead.
import type { AggregatorReceivableRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { HonestyPill } from '@/components/Honesty'
import {
  dataTableCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export default function AggregatorTable({ rows }: { rows: AggregatorReceivableRow[] }) {
  const total = rows.reduce((a, r) => a + decimalStringToPaise(r.outstanding), 0)

  return (
    <div className="overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Partner</th>
            <th className={thNumCls}>Agreed</th>
            <th className={thNumCls}>Billed</th>
            <th className={thNumCls}>Received</th>
            <th className={thNumCls}>Outstanding</th>
            <th className={thNumCls}>Last settled</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const out = decimalStringToPaise(r.outstanding)
            const nothingBilled = decimalStringToPaise(r.gross_billed) === 0
            return (
              <tr key={r.partner} className={trCls}>
                <td className={tdCls}>
                  <span className="font-medium">{r.partner}</span>
                  {nothingBilled && (
                    <span className="ml-2 align-middle">
                      <HonestyPill>nothing billed</HonestyPill>
                    </span>
                  )}
                </td>
                <td className={tdNumCls}>
                  {r.agreed_commission_pct === null ? (
                    <span className="font-sans text-xs text-amber-800">no agreed rate</span>
                  ) : (
                    `${r.agreed_commission_pct}%`
                  )}
                </td>
                <td className={tdNumCls}>{formatMoneyString(r.gross_billed)}</td>
                <td className={tdNumCls}>{formatMoneyString(r.received)}</td>
                <td
                  className={`${tdNumCls} font-semibold ${out < 0 ? 'text-emerald-700' : 'text-stone-900'}`}
                >
                  {formatMoneyString(r.outstanding)}
                </td>
                <td className={tdNumCls}>
                  {r.last_settled === null ? (
                    <span className="font-sans text-xs text-amber-800">never settled</span>
                  ) : (
                    <span className="font-sans text-stone-600">{fmtDate(r.last_settled)}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${tdCls} font-medium text-stone-500`} colSpan={4}>
              {rows.length} {rows.length === 1 ? 'partner' : 'partners'}
            </td>
            <td className={`${tdNumCls} font-semibold`}>{formatPaise(total)}</td>
            <td className={tdNumCls} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
