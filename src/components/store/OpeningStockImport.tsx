'use client'

import { useState } from 'react'
import { importOpeningStockCsv, previewOpeningStockCsv } from '@/server/opening-stock-import'
import type { SaveAdjustmentsResult } from '@/lib/types'
import { cardCls, btnCls, inputCls, fieldLabelCls, numCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'

export default function OpeningStockImport({ today, contract }: { today: string; contract: string }) {
  const [date, setDate] = useState(today)
  const [csv, setCsv] = useState('code,quantity\n')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SaveAdjustmentsResult | null>(null)
  const [preview, setPreview] = useState<{ date: string; count: number; pending: boolean } | null>(null)
  async function previewFile() {
    setBusy(true); setResult(null); setPreview(null)
    try { const checked = await previewOpeningStockCsv({ date, csv, note }); if (checked.ok) setPreview(checked); else setResult(checked) } catch { setResult({ ok: false, error: 'Could not reach the server — nothing was written' }) } finally { setBusy(false) }
  }
  async function submit() {
    if (!preview) return; setBusy(true); setResult(null)
    try { const checked = await importOpeningStockCsv({ date, csv, note }); setResult(checked); if (checked.ok) setPreview(null) } catch { setResult({ ok: false, error: 'Could not reach the server — nothing was imported' }) } finally { setBusy(false) }
  }
  return <div className="space-y-4"><section className={cardCls}><h2 className="font-display text-lg font-bold text-stone-900">Import opening stock</h2><p className="mt-1 text-sm text-stone-600">{contract} Preview resolves every item and writes nothing; commit then uses the normal approval rule.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label><span className={fieldLabelCls}>Opening date</span><input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPreview(null) }} className={`${numCls} w-full`} /></label><label><span className={fieldLabelCls}>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputCls} /></label></div><label className="mt-3 block"><span className={fieldLabelCls}>CSV</span><textarea value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null) }} rows={10} spellCheck={false} className={`${inputCls} min-h-48 w-full font-mono text-sm`} /></label>{preview && <p className="mt-2 text-sm text-green-700">Ready: {preview.count} items for {preview.date}. {preview.pending ? 'Owner approval will be required.' : 'No owner approval is configured.'} Nothing has been written.</p>}<div className="mt-3 flex gap-2"><button type="button" disabled={busy || csv.trim() === ''} onClick={() => void previewFile()} className={btnCls}>{busy ? 'Checking…' : 'Preview import'}</button><button type="button" disabled={busy || !preview} onClick={() => void submit()} className={btnCls}>{busy ? 'Importing…' : 'Commit import'}</button></div></section>{result?.ok && <SaveAck headline={result.pending ? `Sent for owner approval — ${result.count} items` : `Opening stock imported — ${result.count} items`} sub={result.pending ? 'The book has not changed yet; the owner must approve the batch.' : 'Costs were snapshotted from the restaurant’s existing item costs.'} onDismiss={() => setResult(null)} />}{result && !result.ok && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{result.error}</p>}</div>
}
