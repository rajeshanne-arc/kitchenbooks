'use client'

import { useState } from 'react'
import { importPurchaseBatchCsv } from '@/server/purchase-import'
import { cardCls, btnCls, inputCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'

type Result = Awaited<ReturnType<typeof importPurchaseBatchCsv>>

export default function PurchaseBatchImport({ contract }: { contract: string }) {
  const [csv, setCsv] = useState('bill_date,bill_no,vendor_code,gst_total,transport,item_code,qty,rate,expiry_date\n')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [previewPassed, setPreviewPassed] = useState(false)

  function changeCsv(value: string) {
    setCsv(value)
    setPreviewPassed(false)
    setResult(null)
  }

  async function submit(dryRun: boolean) {
    setBusy(true)
    setResult(null)
    try {
      const next = await importPurchaseBatchCsv({ csv, dryRun })
      setResult(next)
      if (dryRun && next.ok) setPreviewPassed(true)
      if (!dryRun && next.ok) setPreviewPassed(false)
    } catch {
      setResult({ ok: false, error: 'Could not reach the server — nothing was imported' })
    } finally {
      setBusy(false)
    }
  }

  return <div className="mx-auto max-w-3xl px-4 pb-8 sm:px-6">
    <section className={cardCls}>
      <h1 className="font-display text-xl font-bold text-stone-900">Import multiple purchase bills</h1>
      <p className="mt-1 text-sm text-stone-600">{contract}</p>
      <label className="mt-4 block"><span className="mb-1 block text-sm font-medium text-stone-700">CSV</span><textarea value={csv} onChange={(e) => changeCsv(e.target.value)} rows={14} spellCheck={false} className={`${inputCls} min-h-64 w-full font-mono text-sm`} /></label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || csv.trim() === ''} onClick={() => void submit(true)} className={btnCls}>{busy ? 'Validating…' : 'Preview all bills'}</button>
        <button type="button" disabled={busy || !previewPassed} onClick={() => void submit(false)} className={`${btnCls} bg-stone-800`}>{busy ? 'Importing…' : 'Commit entire batch'}</button>
      </div>
      <p className="mt-2 text-xs text-stone-500">Editing the file clears the preview. Commit is all-or-nothing; a failed bill rolls back the complete batch.</p>
    </section>
    {result?.ok && result.preview && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Preview passed: {result.preview.bills} bills, {result.preview.lines} lines, goods value ₹{result.preview.goodsValue}. Nothing was written.</div>}
    {result?.ok && !result.preview && <SaveAck headline={`${result.imported} purchase bills imported`} sub="Every bill used the normal stock, lot, dues, tax, and journal path." onDismiss={() => setResult(null)} />}
    {result && !result.ok && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{result.error}</p>}
  </div>
}
