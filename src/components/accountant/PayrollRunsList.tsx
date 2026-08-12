// Every run this restaurant has prepared, newest period first. Cancelled ones
// stay on the list: a run that was prepared and abandoned is itself a thing
// that happened, and hiding it would make the record read as if the month had
// only ever been done once.
import Link from 'next/link'
import type { PayrollRunRow } from '@/lib/types'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import RunStatus from '@/components/accountant/RunStatus'
import { HonestyPill } from '@/components/Honesty'
import {
  dataTableCls,
  docNoCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export default function PayrollRunsList({ runs }: { runs: PayrollRunRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Period</th>
            <th className={thCls}>Doc</th>
            <th className={thNumCls}>Lines</th>
            <th className={thNumCls}>Net</th>
            <th className={thCls}>Status</th>
            <th className={thCls}>Prepared</th>
            <th className={thCls}>Approved</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className={trCls}>
              <td className={`${tdCls} whitespace-nowrap`}>
                <Link
                  href={`/accounts/payroll/runs/${r.id}`}
                  className="font-medium underline underline-offset-2 hover:text-emerald-800"
                >
                  {fmtDate(r.period_start)} — {fmtDate(r.period_end)}
                </Link>
              </td>
              <td className={tdCls}>
                {r.doc_no === null ? (
                  <span className="text-stone-300">—</span>
                ) : (
                  <span className={docNoCls}>{r.doc_no}</span>
                )}
              </td>
              <td className={tdNumCls}>{r.line_count}</td>
              {/* a run with no lines cannot happen — but a sum over no rows is
                  not a zero, so it would not be reported as one */}
              <td className={tdNumCls}>
                {r.line_count === 0 ? (
                  <HonestyPill>no lines</HonestyPill>
                ) : (
                  formatMoneyString(r.net_total)
                )}
              </td>
              <td className={tdCls}>
                <RunStatus status={r.status} />
              </td>
              <td className={`${tdCls} whitespace-nowrap text-stone-500`}>
                {r.prepared_by ?? '—'}
              </td>
              <td className={`${tdCls} whitespace-nowrap text-stone-500`}>
                {r.approved_by ?? <span className="text-stone-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
