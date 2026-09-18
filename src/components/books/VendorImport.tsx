'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { importVendorsCsv, previewVendorsCsv } from '@/server/vendor-import'
import { btnCls, cardCls, inputCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'
export default function VendorImport({ contract }: { contract: string }) {
  const router = useRouter(); const [csv, setCsv] = useState(''); const [busy, setBusy] = useState(false); const [preview, setPreview] = useState<{ count: number; firstCodes: string[] } | null>(null)
  async function previewFile() { if (busy) return; setBusy(true); setPreview(null); try { const result = await previewVendorsCsv({ csv }); if (!result.ok) toast(result.error, 'error'); else setPreview(result) } catch { toast('Could not reach the server — nothing was written', 'error') } finally { setBusy(false) } }
  async function commit() { if (busy || !preview) return; setBusy(true); try { const result = await importVendorsCsv({ csv }); if (!result.ok) toast(result.error, 'error'); else { toast(String(result.count) + ' vendors imported', 'ok'); setCsv(''); setPreview(null); router.refresh() } } catch { toast('Could not reach the server — nothing was imported', 'error') } finally { setBusy(false) } }
  return <section className={cardCls + ' mt-4'}><h2 className={sectionHeadCls}>Import vendors</h2><p className="mt-1 text-sm text-stone-600">{contract} Preview checks the complete file and writes nothing.</p><textarea value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null) }} rows={8} spellCheck={false} className={inputCls + ' mt-3 min-h-40 w-full font-mono text-sm'} placeholder="name,category,gstin,phone,payment_terms" />{preview ? <p className="mt-2 text-sm text-green-700">Ready: {preview.count} vendors; next codes {preview.firstCodes.join(', ')}. Nothing has been written.</p> : null}<div className="mt-3 flex gap-2"><button type="button" disabled={busy || csv.trim() === ''} onClick={() => void previewFile()} className={btnCls}>{busy ? 'Checking…' : 'Preview import'}</button><button type="button" disabled={busy || !preview} onClick={() => void commit()} className={btnCls}>{busy ? 'Importing…' : 'Commit import'}</button></div></section>
}
