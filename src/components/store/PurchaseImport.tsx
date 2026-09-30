'use client'

import { useState } from 'react'
import { importPurchaseCsv } from '@/server/purchase-import'
import { cardCls, btnCls, inputCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'

export default function PurchaseImport({ contract }: { contract: string }) {
  const [csv, setCsv] = useState('bill_date,vendor_code,gst_total,transport,item_code,qty,rate,expiry_date\n')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: true; purchaseId: string; preview?: { vendorCode: string; billDate: string; lines: number; goodsValue: string } } | { ok: false; error: string } | null>(null)
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
      const next = await importPurchaseCsv({ csv, dryRun })
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
      <h1 className="font-display text-xl font-bold text-stone-900">Import purchase bill</h1>
      <p className="mt-1 text-sm text-stone-600">{contract}</p>
      <p className="mt-2 text-sm text-stone-600">Use an existing active vendor and item code. The complete file becomes one bill; every row must repeat the same bill date, vendor, GST total, and transport total.</p>
      <label className="mt-4 block"><span className="mb-1 block text-sm font-medium text-stone-700">CSV</span><textarea value={csv} onChange={(e) => changeCsv(e.target.value)} rows={12} spellCheck={false} className={`${inputCls} min-h-56 w-full font-mono text-sm`} /></label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || csv.trim() === ''} onClick={() => void submit(true)} className={btnCls}>{busy ? 'Validating…' : 'Preview only'}</button>
        <button type="button" disabled={busy || !previewPassed} onClick={() => void submit(false)} className={`${btnCls} bg-stone-800`}>{busy ? 'Working…' : 'Import after preview'}</button>
      </div>
      <p className="mt-2 text-xs text-stone-500">Preview the complete file first. Editing the CSV clears the preview and requires validation again.</p>
    </section>
    {result?.ok && result.preview && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Preview passed: {result.preview.lines} lines for vendor {result.preview.vendorCode}, dated {result.preview.billDate}, goods value ₹{result.preview.goodsValue}. Nothing was written.</div>}
    {result?.ok && !result.preview && <SaveAck headline="Purchase bill imported" sub={`Bill ${result.purchaseId} was recorded through the normal stock, dues, tax, and journal path.`} onDismiss={() => setResult(null)} />}
    {result && !result.ok && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{result.error}</p>}
  </div>
}
