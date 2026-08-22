// THE SAME ROWS, TOTALLED BY PARTY — the question you ask before you ask for
// the lines: who did most of this.
//
// It takes the register's OWN rows rather than a second query, so the two views
// can never disagree about a period: a summary fetched separately would be one
// filter change away from totalling a different set than the detail beneath it.

import { decimalStringToPaise, formatPaise } from '@/lib/money'
import type { RegisterRow } from '@/lib/types'
import { dataTableCls, tdCls, tdNumCls, thCls, thNumCls, trCls } from '@/components/ui'

const paise = (v: string | null) => (v === null ? 0 : decimalStringToPaise(v))

export default function RegisterSummary({ rows }: { rows: RegisterRow[] }) {
  const byParty = new Map<string, { debit: number; credit: number; n: number }>()
  for (const r of rows) {
    const key = r.party === '' ? '—' : r.party
    const g = byParty.get(key) ?? { debit: 0, credit: 0, n: 0 }
    g.debit += paise(r.debit)
    g.credit += paise(r.credit)
    g.n += 1
    byParty.set(key, g)
  }
  // Biggest first, on the side that carries the money for this register —
  // a register is either mostly debits or mostly credits, so ranking on the
  // larger of the two is what puts the significant party at the top either way.
  const parties = [...byParty.entries()].sort(
    (a, b) => Math.max(b[1].debit, b[1].credit) - Math.max(a[1].debit, a[1].credit),
  )
  const debit = rows.reduce((n, r) => n + paise(r.debit), 0)
  const credit = rows.reduce((n, r) => n + paise(r.credit), 0)

  if (rows.length === 0) {
    return (
      <p className="text-sm text-stone-500">
        Nothing in this period — which is an empty register, not a zero. Widen the dates to see whether
        anything was ever entered here.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Party</th>
            <th className={thNumCls}>Entries</th>
            <th className={thNumCls}>Debit</th>
            <th className={thNumCls}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {parties.map(([party, g]) => (
            <tr key={party} className={trCls}>
              <td className={tdCls}>{party}</td>
              <td className={`${tdNumCls} text-stone-500`}>{g.n}</td>
              <td className={tdNumCls}>{g.debit === 0 ? '—' : formatPaise(g.debit)}</td>
              <td className={tdNumCls}>{g.credit === 0 ? '—' : formatPaise(g.credit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-rule font-semibold">
            <td className={tdCls}>{parties.length} parties</td>
            <td className={`${tdNumCls} text-stone-500`}>{rows.length}</td>
            <td className={tdNumCls}>{formatPaise(debit)}</td>
            <td className={tdNumCls}>{formatPaise(credit)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-2 text-xs text-stone-400">
        Totalled from the rows below the toggle, not fetched again — the two views cannot disagree about a
        period.
      </p>
    </div>
  )
}
