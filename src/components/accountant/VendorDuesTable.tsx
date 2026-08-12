// Who we owe, worst first.
//
// The column that earns its place is "last paid", because two facts that a
// single number would flatten are not the same thing: a vendor NEVER paid is
// a relationship that has not started (and often a bill entered against the
// wrong party); a vendor paid a long time ago is one that has stalled. The
// view hands both over — days_since_payment is null for the first — and this
// table keeps them apart in words rather than printing a large number for
// one and a larger one for the other.
import Link from 'next/link'
import type { VendorDueRow } from '@/lib/types'
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

/** past this, "paid" is history rather than a rhythm */
const STALE_DAYS = 30

export default function VendorDuesTable({ rows }: { rows: VendorDueRow[] }) {
  const total = rows.reduce((a, r) => a + decimalStringToPaise(r.balance), 0)

  return (
    <div className="overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Vendor</th>
            <th className={thCls}>Code</th>
            <th className={thCls}>Terms</th>
            <th className={thNumCls}>Last paid</th>
            <th className={thNumCls}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const bal = decimalStringToPaise(r.balance)
            const stale = r.days_since_payment !== null && r.days_since_payment > STALE_DAYS
            return (
              <tr key={r.id} className={trCls}>
                <td className={tdCls}>
                  <Link
                    href={`/accounts/parties/${r.id}`}
                    className="font-medium hover:text-emerald-700 hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="block text-[11px] text-stone-400">{r.category_name}</span>
                </td>
                <td className={tdCodeCls}>{r.code}</td>
                <td className={`${tdCls} text-stone-500`}>{r.payment_terms ?? '—'}</td>
                <td className={tdNumCls}>
                  {r.days_since_payment === null ? (
                    <span className="font-sans text-xs text-amber-800">never paid</span>
                  ) : (
                    <span className={stale ? 'font-semibold text-amber-800' : 'text-stone-600'}>
                      {r.days_since_payment}d
                      {r.last_paid_date !== null && (
                        <span className="ml-1 font-sans text-[11px] text-stone-400">
                          {fmtDate(r.last_paid_date)}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td
                  className={`${tdNumCls} font-semibold ${bal < 0 ? 'text-emerald-700' : 'text-stone-900'}`}
                >
                  {formatMoneyString(r.balance)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${tdCls} font-medium text-stone-500`} colSpan={4}>
              {rows.length} {rows.length === 1 ? 'vendor' : 'vendors'} carrying a balance
            </td>
            <td className={`${tdNumCls} font-semibold`}>{formatPaise(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
