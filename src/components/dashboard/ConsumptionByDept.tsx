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

  const total = depts.reduce((a, d) => a + d.paise, 0)

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
                {depts.map((d) => (
                  <tr key={d.code} className={trCls}>
                    <td className={tdCls}>{d.name}</td>
                    <td className={`${tdNumCls} text-stone-500`}>{d.days}</td>
                    <td className={tdNumCls}>{formatPaise(d.paise)}</td>
                  </tr>
                ))}
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
