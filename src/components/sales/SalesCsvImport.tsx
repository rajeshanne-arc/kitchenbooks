'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { importSalesCsv, previewSalesCsv } from '@/server/sales-csv-import'
import { btnCls, cardCls, inputCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'
export default function SalesCsvImport({ contract }: { contract: string }) {
  const router = useRouter(); const [csv, setCsv] = useState(''); const [busy, setBusy] = useState(false); const [preview, setPreview] = useState<{ date: string; count: number } | null>(null)
  async function previewFile() { if (busy) return; setBusy(true); setPreview(null); try { const result = await previewSalesCsv({ csv }); if (!result.ok) toast(result.error, 'error'); else setPreview(result) } catch { toast('Could not reach the server — nothing was written', 'error') } finally { setBusy(false) } }
  async function commit() { if (busy || !preview) return; setBusy(true); try { const result = await importSalesCsv({ csv }); if (!result.ok) toast(result.error, 'error'); else { toast(String(result.count) + ' sales imported for ' + result.date, 'ok'); setCsv(''); setPreview(null); router.push('/sales/books/sales') } } catch { toast('Could not reach the server — nothing was imported', 'error') } finally { setBusy(false) } }
  return <section className={cardCls + ' mt-4'}><h2 className={sectionHeadCls}>Import sales CSV</h2><p className="mt-1 text-sm text-stone-600">{contract} Preview validates without creating a POS generation.</p><textarea value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null) }} rows={9} spellCheck={false} className={inputCls + ' mt-3 min-h-44 w-full font-mono text-sm'} placeholder="business_date,pos_order_id,status,order_total,payment_mode,channel,subtotal,tax" />{preview ? <p className="mt-2 text-sm text-green-700">Ready: {preview.count} sales for {preview.date}. Nothing has been written.</p> : null}<div className="mt-3 flex gap-2"><button type="button" disabled={busy || csv.trim() === ''} onClick={() => void previewFile()} className={btnCls}>{busy ? 'Checking…' : 'Preview import'}</button><button type="button" disabled={busy || !preview} onClick={() => void commit()} className={btnCls}>{busy ? 'Importing…' : 'Commit import'}</button></div></section>
}
