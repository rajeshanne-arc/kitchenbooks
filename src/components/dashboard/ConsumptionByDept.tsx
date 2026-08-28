'use client'

// What each department consumed, in RUPEES, for the period.
//
// QUANTITY ON THE INDENT, VALUE HERE. The indent form stays purely in
// quantities on purpose: at the moment of asking for onions, a rupee figure
// invites the chef to trim the request to look good rather than ask for
// what the menu needs. But the chef IS accountable for what their
// department consumed at month end — so the value belongs after the asking,
// where it informs a conversation instead of distorting a request.
//
// section_consumption_daily nets returns already. Nothing here re-subtracts
// them, and nothing here re-derives a figure the view has stated.
//
// A DEPARTMENT EXPANDS TO ITS DAYS, because the children are already here: the
// component receives every (department, day, session) row and aggregates them
// itself, so opening one fetches nothing. That is the whole test — an expand
// that has to fetch is worse than a link that moves you.
//
// NO "SEE ALL", and that is a finding rather than an omission: there is no
// per-day consumption view anywhere in the app to send somebody to. The
// department page reports a period TOTAL, not these rows. So the tail names
// its value and stops, rather than promising a page that does not exist.
'use client'

import { Fragment, useCallback, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { fmtDate } from '@/lib/format'
import type { SectionConsumptionDay } from '@/lib/types'
import { decimalStringToPaise, formatPaise } from '@/lib/money'
import { MagnitudeBars } from '@/components/dashboard/Charts'
import Honesty from '@/components/Honesty'
import {
  cardCls,
  dataTableCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

/** A period can be three months, so the day list has no natural ceiling the
 *  way a purchase day does. Two weeks is a reading unit; beyond it the tail
 *  names its value and stops — there is no per-day view to link to. */
const DAY_CAP = 14

export default function ConsumptionByDept({
  rows,
  title = 'Consumed by department',
  /** shown under the head so the reader knows which days are in the figure */
  caption,
}: {
  rows: SectionConsumptionDay[]
  title?: string
  caption: string
}) {
  const byDept = new Map<string, { name: string; paise: number; days: Set<string> }>()
  for (const r of rows) {
    const cur = byDept.get(r.section_code) ?? { name: r.section_name, paise: 0, days: new Set<string>() }
    cur.paise += decimalStringToPaise(r.consumed_value)
    cur.days.add(r.move_date)
    byDept.set(r.section_code, cur)
  }
  const depts = [...byDept.entries()]
    .map(([code, v]) => ({ code, name: v.name, paise: v.paise, days: v.days.size }))
    .sort((a, b) => b.paise - a.paise)

  // CHILDREN GROUPED BY DATE, NOT BY ROW. The view's grain is (department,
  // day, SESSION) — live data already has one department taking stock twice in
  // a day — so listing raw rows would show more lines than the "Days" figure
  // in the parent claims. Grouping by date makes the child count equal that
  // figure exactly, which is the count-beside-sum discipline: the sum catches a
  // wrong value and the count catches a row that should not be there.
  const daysOf = (code: string) => {
    const byDay = new Map<string, { paise: number; sessions: Set<string>; movements: number }>()
    for (const r of rows) {
      if (r.section_code !== code) continue
      const cur = byDay.get(r.move_date) ?? { paise: 0, sessions: new Set<string>(), movements: 0 }
      cur.paise += decimalStringToPaise(r.consumed_value)
      cur.sessions.add(r.session)
      cur.movements += r.movements
      byDay.set(r.move_date, cur)
    }
    // NEWEST FIRST. These are a time series, not a ranking — "top ten by value"
    // would be the wrong question about a run of days, and the day somebody is
    // asking about is almost always a recent one.
    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, v]) => ({ date, paise: v.paise, sessions: [...v.sessions].sort(), movements: v.movements }))
  }

  const total = depts.reduce((a, d) => a + d.paise, 0)

  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [open, setOpen] = useState<string | null>(sp.get('dept'))
  const toggle = useCallback(
    (code: string | null) => {
      setOpen(code)
      const params = new URLSearchParams(sp.toString())
      if (code === null) params.delete('dept')
      else params.set('dept', code)
      const qs = params.toString()
      router.replace((qs === '' ? pathname : `${pathname}?${qs}`) as Parameters<typeof router.replace>[0], {
        scroll: false,
      })
    },
    [pathname, router, sp],
  )

  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>{title}</h2>
        <span className="font-mono text-[10px] text-stone-400">section_consumption_daily</span>
      </div>
      <p className="mt-1 text-xs text-stone-500">{caption}</p>

      {depts.length === 0 ? (
        // A sum over no rows is not a zero. Nothing was issued, or nothing
        // has been entered yet — and this cannot tell those apart.
        <div className="mt-2">
          <Honesty verdict="nothing issued">
            No stock left the store for any department in this period. That is either a quiet stretch
            or entries that have not been made — the books cannot tell the two apart, and neither can
            this card.
          </Honesty>
        </div>
      ) : (
        <>
          <div className="mt-2">
            <MagnitudeBars rows={depts.map((d) => ({ label: d.name, value: d.paise / 100 }))} />
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Department</th>
                  <th className={thNumCls}>Days</th>
                  <th className={thNumCls}>Consumed</th>
                </tr>
              </thead>
              <tbody>
                {depts.map((d) => {
                  const isOpen = open === d.code
                  const all = isOpen ? daysOf(d.code) : []
                  const shown = all.slice(0, DAY_CAP)
                  const hidden = all.length - shown.length
                  // THE TAIL IS THE PARENT MINUS WHAT IS SHOWN, never a second
                  // sum of its own rows: consumed_value carries more decimals
                  // than paise, so summing the hidden rows after rounding each
                  // one would not equal the header above them. Deriving it
                  // makes the two halves add up by construction.
                  const shownPaise = shown.reduce((n, x) => n + x.paise, 0)
                  return (
                    <Fragment key={d.code}>
                      <tr
                        className={`${trCls} cursor-pointer hover:bg-stone-50 ${isOpen ? 'bg-stone-50' : ''}`}
                        onClick={() => toggle(isOpen ? null : d.code)}
                      >
                        <td className={tdCls}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggle(isOpen ? null : d.code)
                            }}
                            aria-expanded={isOpen}
                            className="mr-1 min-h-[40px] min-w-[24px] text-left"
                          >
                            <span
                              aria-hidden
                              className={`inline-block text-stone-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                            >
                              ›
                            </span>
                          </button>
                          {d.name}
                        </td>
                        <td className={`${tdNumCls} text-stone-500`}>{d.days}</td>
                        <td className={tdNumCls}>{formatPaise(d.paise)}</td>
                      </tr>
                      {isOpen &&
                        shown.map((x) => (
                          <tr key={`${d.code}-${x.date}`} className="bg-stone-50/70">
                            <td className={`${tdCls} pl-10 text-stone-600`}>
                              {fmtDate(x.date)}
                              <span className="ml-2 text-[11px] text-stone-400">{x.sessions.join(' · ')}</span>
                            </td>
                            <td className={`${tdNumCls} text-[11px] text-stone-400`}>
                              {x.movements} {x.movements === 1 ? 'move' : 'moves'}
                            </td>
                            <td className={`${tdNumCls} text-stone-600`}>{formatPaise(x.paise)}</td>
                          </tr>
                        ))}
                      {isOpen && hidden > 0 && (
                        <tr className="bg-stone-50/70">
                          <td className={`${tdCls} pl-10 text-xs text-stone-500`} colSpan={2}>
                            {hidden} earlier {hidden === 1 ? 'day' : 'days'}
                          </td>
                          <td className={`${tdNumCls} text-xs text-stone-500`}>
                            {formatPaise(d.paise - shownPaise)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className={`${tdCls} font-medium text-stone-500`} colSpan={2}>
                    {depts.length} {depts.length === 1 ? 'department' : 'departments'}
                  </td>
                  <td className={`${tdNumCls} font-semibold`}>{formatPaise(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Issues out less anything sent back, valued at the cost the stock was issued at. Quantities
            live on the indent; this is the same movement counted in money.
          </p>
        </>
      )}
    </section>
  )
}
