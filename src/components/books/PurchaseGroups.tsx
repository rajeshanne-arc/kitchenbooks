import { Fragment } from 'react'
import Link from 'next/link'
import type { BillRow } from '@/lib/types'
import { formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import BillList from './BillList'
import { dataTableCls, tdCls, tdCodeCls, tdNumCls, thCls, thNumCls, trCls } from '@/components/ui'

/**
 * BY DAY and BY VENDOR — the same rows as the register, grouped.
 *
 * EXPANDING IS INLINE HERE AND NAVIGATES ON STOCK, and the difference is
 * quantitative rather than a matter of taste. Measured on live data: the
 * busiest August day carries 25 bills and the average 12; the busiest vendor
 * 25 and the average 10. That fans out to about a screen. An item's stock
 * ledger expands to 115 rows, so it gets a page. Do not harmonise the two.
 *
 * THE OPEN GROUP LIVES IN THE URL — ?day=2026-08-04, ?vendor=V-DRY-01 — so an
 * opened day is shareable and behaves like every other filter in this app.
 * One at a time: two open groups is a second scroll and no second question.
 */

export type DayGroup = { key: string; bills: number; vendors: number; paise: number }
export type VendorGroup = {
  key: string
  name: string
  code: string
  bills: number
  paise: number
  share: number
}

/** The chevron only ever agrees with the row's state; it never carries it alone. */
function Chevron({ open }: { open: boolean }) {
  return (
    <span aria-hidden className={`inline-block text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`}>
      ›
    </span>
  )
}

function ExpandedBills({ bills, showVendor }: { bills: BillRow[]; showVendor: boolean }) {
  return (
    <tr>
      <td colSpan={5} className="bg-stone-50/70 px-2 py-1">
        {/* THE BILL NAVIGATES, the group expands. A document has a page. */}
        <BillList bills={bills} showVendor={showVendor} />
      </td>
    </tr>
  )
}

export function ByDay({
  groups,
  bills,
  open,
  hrefFor,
}: {
  groups: DayGroup[]
  bills: BillRow[]
  open: string | null
  hrefFor: (day: string | null) => string
}) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Date</th>
            <th className={thNumCls}>Bills</th>
            <th className={thNumCls}>Vendors</th>
            <th className={thNumCls}>Spend</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isOpen = open === g.key
            return (
              <Fragment key={g.key}>
                <tr className={trCls}>
                  <td className={tdCls}>
                    <Link href={hrefFor(isOpen ? null : g.key)} className="hover:underline">
                      <Chevron open={isOpen} /> {fmtDate(g.key)}
                    </Link>
                  </td>
                  <td className={`${tdNumCls} text-stone-500`}>{g.bills}</td>
                  <td className={`${tdNumCls} text-stone-500`}>{g.vendors}</td>
                  <td className={`${tdNumCls} font-semibold`}>{formatPaise(g.paise)}</td>
                  <td className={tdCls} />
                </tr>
                {isOpen && <ExpandedBills bills={bills.filter((b) => b.bill_date === g.key)} showVendor />}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ByVendor({
  groups,
  bills,
  open,
  hrefFor,
}: {
  groups: VendorGroup[]
  bills: BillRow[]
  open: string | null
  hrefFor: (code: string | null) => string
}) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className={dataTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Vendor</th>
            <th className={thCls}>Code</th>
            <th className={thNumCls}>Bills</th>
            <th className={thNumCls}>Spend</th>
            <th className={thNumCls}>Share</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isOpen = open === g.code
            return (
              <Fragment key={g.key}>
                <tr className={trCls}>
                  <td className={tdCls}>
                    <Link href={hrefFor(isOpen ? null : g.code)} className="hover:underline">
                      <Chevron open={isOpen} /> {g.name}
                    </Link>
                  </td>
                  <td className={tdCodeCls}>{g.code}</td>
                  <td className={`${tdNumCls} text-stone-500`}>{g.bills}</td>
                  <td className={`${tdNumCls} font-semibold`}>{formatPaise(g.paise)}</td>
                  <td className={`${tdNumCls} text-stone-500`}>{g.share.toFixed(1)}%</td>
                </tr>
                {isOpen && (
                  <ExpandedBills bills={bills.filter((b) => b.vendor_code === g.code)} showVendor={false} />
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
