'use client'

import { useState } from 'react'
import type { PosStatementComparison } from '@/server/pos-statement-queries'
import { importPosStatement, previewPosStatement } from '@/server/pos-statement-actions'
import { btnCls, cardCls, inputCls, sectionHeadCls } from '@/components/ui'
import PosDifferenceReview from './PosDifferenceReview'

export default function PosStatementReconciliation({ initial }: { initial: PosStatementComparison[] }) {
  const [csv, setCsv] = useState('business_date,amount,order_id,payment_mode,status\n')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState(initial)
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ rows: number; dates: number; total: string } | null>(null)

  function changeCsv(value: string) { setCsv(value); setPreview(null); setMessage(null) }

  async function inspect() {
    setBusy(true); setMessage(null)
    const result = await previewPosStatement({ csv })
    setBusy(false)
    if (result.ok) setPreview({ rows: result.rows, dates: result.dates, total: result.total })
    else setMessage(result.error)
  }

  async function submit() {
    if (preview === null) return
    setBusy(true); setMessage(null)
    const result = await importPosStatement({ csv, note })
    setBusy(false)
    if (result.ok) { setRows(result.comparisons); setPreview(null); setMessage('Statement imported. Review every difference before deciding on a correction.') }
    else setMessage(result.error)
  }

  return <div className="space-y-4"><section className={cardCls}><h2 className={sectionHeadCls}>Import provider statement</h2><p className="mt-1 text-sm text-stone-600">CSV columns: <span className="font-mono">business_date,amount[,order_id,payment_mode,status]</span>. The file is retained as evidence; it never overwrites POS sales.</p><textarea value={csv} onChange={(e) => changeCsv(e.target.value)} rows={8} className={`${inputCls} mt-3 min-h-40 w-full font-mono text-sm`} spellCheck={false} /><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Statement note (optional)" className={`${inputCls} mt-2`} />{preview !== null && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Preview passed: {preview.rows} rows across {preview.dates} dates, total ₹{preview.total}. Nothing has been written.</p>}{message && <p className="mt-3 text-sm text-stone-700">{message}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || csv.trim() === ''} onClick={() => void inspect()} className={btnCls}>{busy ? 'Checking…' : 'Preview only'}</button><button type="button" disabled={busy || preview === null} onClick={() => void submit()} className={`${btnCls} bg-stone-800`}>{busy ? 'Importing…' : 'Import after preview'}</button></div><p className="mt-2 text-xs text-stone-500">Editing the CSV clears the preview and requires validation again.</p></section><section className={cardCls}><h2 className={sectionHeadCls}>Statement versus KitchenBooks</h2>{rows.length === 0 ? <p className="mt-2 text-sm text-stone-600">No provider statements imported.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-rule-soft text-xs text-stone-500"><tr><th className="py-2 pr-3">Date</th><th className="py-2 pr-3 text-right">Statement</th><th className="py-2 pr-3 text-right">Books</th><th className="py-2 text-right">Difference</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.import_id}-${row.business_date}`} className="border-b border-rule-soft last:border-0"><td className="py-2 pr-3">{row.business_date}</td><td className="py-2 pr-3 text-right">{row.statement_orders} · ₹{row.statement_total}</td><td className="py-2 pr-3 text-right">{row.books_orders} · ₹{row.books_total}</td><td className={`py-2 text-right font-medium ${Number(row.difference) === 0 ? 'text-emerald-700' : 'text-red-700'}`}>₹{row.difference}<PosDifferenceReview importId={row.import_id} date={row.business_date} initialNote={row.review_note} status={row.review_status} /></td></tr>)}</tbody></table></div>}<p className="mt-3 text-xs text-stone-500">A difference is a review item. Re-fetch the POS day or record a separately approved correction; this screen does not guess which source is right.</p></section></div>
}
