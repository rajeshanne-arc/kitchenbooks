import Link from 'next/link'
import { cardCls, sectionHeadCls } from '@/components/ui'
import { formatMoneyString } from '@/lib/money'

export type PrepDemandRow = { recipeId: string; code: string; name: string; qty: string; value: string }

export default function PrepDemand({ rows, monthLabel, enabled }: { rows: PrepDemandRow[]; monthLabel: string; enabled: boolean }) {
  return <section className={cardCls}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className={sectionHeadCls}>Prep demand · {monthLabel}</h2>
      <span className="font-mono text-[10px] text-stone-400">mapped POS portions</span>
    </div>
    {!enabled ? <p className="mt-2 text-sm text-stone-700">POS stock reconciliation is off. This kitchen does not use POS-derived prep quantities.</p> : rows.length === 0 ? <p className="mt-2 text-sm text-stone-700">No mapped POS dish sales are available for this month. Map a POS item to a dish before using this demand list.</p> : <>
      <p className="mt-1 text-xs text-stone-500">A planning signal for portions sold, not a stock issue. Store issues remain the source of actual ingredient consumption.</p>
      <ul className="mt-2 divide-y divide-rule-soft">{rows.map((row) => <li key={row.recipeId} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"><span><Link href={`/kitchen/recipes/${row.recipeId}`} className="font-medium text-emerald-800 underline">{row.code} · {row.name}</Link><span className="block text-xs text-stone-500">{formatMoneyString(row.value)} POS value</span></span><span className="font-semibold tabular-nums text-stone-900">{row.qty} portions</span></li>)}</ul>
    </>}
  </section>
}
