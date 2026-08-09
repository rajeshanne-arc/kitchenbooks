import Link from 'next/link'
import type { BillRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { ReversalBadge, VoidedBadge } from './Badges'

export default function BillList({ bills, showVendor = true }: { bills: BillRow[]; showVendor?: boolean }) {
  return (
    <ul className="divide-y divide-stone-100">
      {bills.map((b) => {
        const neg = decimalStringToPaise(b.bill_total) < 0
        const title = showVendor ? b.vendor_name : (b.bill_no ?? 'Bill')
        return (
          <li key={b.id}>
            <Link
              href={`/books/bills/${b.id}`}
              className={`flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-stone-50 ${
                b.is_reversal ? 'border-l-2 border-violet-300 pl-3' : ''
              }`}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[15px] font-medium text-stone-900">{title}</span>
                  {b.is_voided && <VoidedBadge />}
                  {b.is_reversal && <ReversalBadge />}
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  {fmtDate(b.bill_date)}
                  {showVendor && (
                    <>
                      {' · '}
                      <span className="font-mono">{b.vendor_code}</span>
                    </>
                  )}
                  {b.bill_no !== null && showVendor && ` · ${b.bill_no}`}
                  {' · '}
                  {b.line_count} {b.line_count === 1 ? 'line' : 'lines'}
                </span>
              </span>
              <span
                className={`shrink-0 text-[15px] font-semibold tabular-nums ${
                  neg ? 'text-red-700' : 'text-stone-900'
                } ${b.is_voided ? 'text-stone-400 line-through decoration-stone-400' : ''}`}
              >
                {formatMoneyString(b.bill_total)}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
