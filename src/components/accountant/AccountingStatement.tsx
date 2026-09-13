import type { AccountingStatementRow, CashFlowRow } from '@/lib/types'
import { cardCls, moneyCls, sectionHeadCls } from '@/components/ui'
import { formatMoneyString } from '@/lib/money'

export function AccountingStatement({ rows, title }: { rows: AccountingStatementRow[]; title: string }) {
  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>{title}</h2>
      {rows.length === 0 ? <p className="mt-2 text-sm text-stone-600">No posted journal lines in this statement.</p> : (
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="border-b border-rule-soft text-xs text-stone-500"><tr><th className="py-2 pr-3">Account</th><th className="py-2 pr-3">Type</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.account_id} className="border-b border-rule-soft last:border-0"><td className="py-2 pr-3"><span className="font-mono text-xs text-stone-500">{row.code}</span> {row.name}</td><td className="py-2 pr-3 text-stone-500">{row.account_type}</td><td className={`py-2 text-right ${moneyCls}`}>{formatMoneyString(row.amount)}</td></tr>)}</tbody>
        </table></div>
      )}
    </section>
  )
}

export function CashFlowStatement({ rows }: { rows: CashFlowRow[] }) {
  return <section className={cardCls}><h2 className={sectionHeadCls}>Mapped cash movement</h2>{rows.length === 0 ? <p className="mt-2 text-sm text-stone-600">No posted movement was found for mapped cash, bank, or wallet accounts.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-rule-soft text-xs text-stone-500"><tr><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Account</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Memo</th><th className="py-2 text-right">Amount</th></tr></thead><tbody>{rows.map((row, i) => <tr key={`${row.entry_date}-${row.source_type}-${i}`} className="border-b border-rule-soft last:border-0"><td className="py-2 pr-3">{row.entry_date}</td><td className="py-2 pr-3">{row.account_name}</td><td className="py-2 pr-3 text-stone-500">{row.source_type}</td><td className="py-2 pr-3">{row.memo}</td><td className={`py-2 text-right ${moneyCls} ${row.direction === 'outflow' ? 'text-rose-700' : 'text-emerald-700'}`}>{row.direction === 'outflow' ? '−' : '+'}{formatMoneyString(row.amount)}</td></tr>)}</tbody></table></div>}</section>
}

export function IndirectCashFlowStatement({ rows }: { rows: CashFlowRow[] }) {
  return <section className={cardCls}><h2 className={sectionHeadCls}>Indirect cash-flow bridge</h2><p className="mt-1 text-xs text-stone-500">Net profit plus non-cash working-capital movement; mapped cash and bank accounts are excluded to avoid double-counting.</p>{rows.length === 0 ? <p className="mt-2 text-sm text-stone-600">No posted journal movement is available for this period.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-rule-soft text-xs text-stone-500"><tr><th className="py-2 pr-3">Basis</th><th className="py-2 pr-3">Account</th><th className="py-2 text-right">Amount</th></tr></thead><tbody>{rows.map((row, i) => <tr key={`${row.account_name}-${i}`} className="border-b border-rule-soft last:border-0"><td className="py-2 pr-3 text-stone-500">{row.memo}</td><td className="py-2 pr-3">{row.account_name}</td><td className={`py-2 text-right ${moneyCls} ${row.direction === 'outflow' ? 'text-rose-700' : 'text-emerald-700'}`}>{row.direction === 'outflow' ? '−' : '+'}{formatMoneyString(row.amount)}</td></tr>)}</tbody></table></div>}</section>
}
