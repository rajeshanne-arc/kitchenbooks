'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { BillRow } from '@/lib/types'
import { formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import BillList from './BillList'
import { dataTableCls, tdCls, tdCodeCls, tdNumCls, thCls, thNumCls, trCls } from '@/components/ui'

/**
 * BY DAY and BY VENDOR — the same rows as the register, grouped.
 *
 * EXPANDING IS NOT A NAVIGATION, and never should have been. The page already
 * loads every bill for the period and both grains expand by FILTERING THAT
 * ARRAY — nothing is fetched by opening a group. The toggle was a <Link>
 * anyway, so each click paid a full server render of a force-dynamic page and
 * Next reset the scroll to the top: the reader lost their place in order to
 * see data the browser was already holding.
 *
 * `<Link scroll={false}>` would have been the wrong fix. It hides the jump and
 * keeps the wasted round trip, which is the actual fault.
 *
 * THE URL IS STILL THE RECORD. `router.replace(..., { scroll: false })` keeps
 * ?day= and ?vendor= shareable — the whole reason they were put there — and
 * the open key is SEEDED FROM THE PARAMS on first render, so a pasted link
 * arrives with the right group already open.
 *
 * EXPANDING IS INLINE HERE AND NAVIGATES ON STOCK, and the difference is
 * quantitative rather than a matter of taste. Measured on live data: the
 * busiest August day carries 25 bills and the average 12; the busiest vendor
 * 25 and the average 10. That fans out to about a screen. An item's stock
 * ledger expands to 115 rows, so it gets a page. Do not harmonise the two.
 */

export type DayGroup = { key: string; bills: number; vendors: number; paise: number }
export type VendorGroup = {
  key: string
  /** the vendor page is keyed by id; the row shows the code */
  vendorId: string
  name: string
  code: string
  bills: number
  paise: number
  share: number
}

/** One open at a time: two open groups is a second scroll and no second
 *  question. Returns the setter the rows call, and keeps the URL in step. */
function useOpenGroup(param: 'day' | 'vendor'): [string | null, (key: string | null) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  // SEEDED FROM THE URL on every render rather than copied into state once —
  // a pasted ?day= must arrive open, and reading the params directly means
  // there is no second source of truth to fall out of step with.
  const fromUrl = sp.get(param)
  const [open, setOpen] = useState<string | null>(fromUrl)

  const toggle = useCallback(
    (key: string | null) => {
      setOpen(key)
      // PRESERVE EVERY OTHER PARAM — period, view and q all live here too.
      const params = new URLSearchParams(sp.toString())
      params.delete('day')
      params.delete('vendor')
      if (key !== null) params.set(param, key)
      const qs = params.toString()
      router.replace((qs === '' ? pathname : `${pathname}?${qs}`) as Parameters<typeof router.replace>[0], {
        scroll: false,
      })
    },
    [param, pathname, router, sp],
  )

  return [open, toggle]
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

export function ByDay({ groups, bills }: { groups: DayGroup[]; bills: BillRow[] }) {
  const [open, toggle] = useOpenGroup('day')
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
              <Row
                key={g.key}
                open={isOpen}
                onToggle={() => toggle(isOpen ? null : g.key)}
                label={fmtDate(g.key)}
                cells={
                  <>
                    <td className={`${tdNumCls} text-stone-500`}>{g.bills}</td>
                    <td className={`${tdNumCls} text-stone-500`}>{g.vendors}</td>
                    <td className={`${tdNumCls} font-semibold`}>{formatPaise(g.paise)}</td>
                    <td className={tdCls} />
                  </>
                }
                expanded={<ExpandedBills bills={bills.filter((b) => b.bill_date === g.key)} showVendor />}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ByVendor({ groups, bills }: { groups: VendorGroup[]; bills: BillRow[] }) {
  const [open, toggle] = useOpenGroup('vendor')
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
              <Row
                key={g.key}
                open={isOpen}
                onToggle={() => toggle(isOpen ? null : g.code)}
                // THE NAME GOES TO THE VENDOR. The chevron and the row open the
                // group; the name is the vendor's own name and belongs to the
                // vendor's page — a name that expands a table instead is the
                // one link on the row that does not go where it says.
                label={
                  <Link
                    href={`/store/masters/vendors/${g.vendorId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="underline decoration-stone-300 underline-offset-2 hover:decoration-stone-600"
                  >
                    {g.name}
                  </Link>
                }
                cells={
                  <>
                    <td className={tdCodeCls}>{g.code}</td>
                    <td className={`${tdNumCls} text-stone-500`}>{g.bills}</td>
                    <td className={`${tdNumCls} font-semibold`}>{formatPaise(g.paise)}</td>
                    <td className={`${tdNumCls} text-stone-500`}>{g.share.toFixed(1)}%</td>
                  </>
                }
                expanded={
                  <ExpandedBills bills={bills.filter((b) => b.vendor_code === g.code)} showVendor={false} />
                }
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** THE WHOLE ROW IS THE TOGGLE, so the target is a row rather than a chevron —
 *  and the vendor link inside it stops the click, or the name would open the
 *  group instead of going to the vendor. */
function Row({
  open,
  onToggle,
  label,
  cells,
  expanded,
}: {
  open: boolean
  onToggle: () => void
  label: React.ReactNode
  cells: React.ReactNode
  expanded: React.ReactNode
}) {
  return (
    <>
      <tr
        className={`${trCls} cursor-pointer hover:bg-stone-50 ${open ? 'bg-stone-50' : ''}`}
        onClick={onToggle}
      >
        <td className={tdCls}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            aria-expanded={open}
            className="mr-1 min-h-[40px] min-w-[28px] text-left"
          >
            <Chevron open={open} />
          </button>
          {label}
        </td>
        {cells}
      </tr>
      {open && expanded}
    </>
  )
}
