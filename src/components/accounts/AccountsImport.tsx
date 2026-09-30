'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { importAccountsCsv, previewAccountsCsv } from '@/server/accounts-import'
import { btnCls, cardCls, inputCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'
export default function AccountsImport({ contract }: { contract: string }) {
  const router = useRouter(); const [csv, setCsv] = useState(''); const [busy, setBusy] = useState(false); const [preview, setPreview] = useState<number | null>(null)
  async function previewFile() { if (busy) return; setBusy(true); setPreview(null); try { const result = await previewAccountsCsv({ csv }); if (!result.ok) toast(result.error, 'error'); else setPreview(result.count) } catch { toast('Could not reach the server — nothing was written', 'error') } finally { setBusy(false) } }
  async function commit() { if (busy || preview === null) return; setBusy(true); try { const result = await importAccountsCsv({ csv }); if (!result.ok) toast(result.error, 'error'); else { toast(String(result.count) + ' accounts imported', 'ok'); setCsv(''); setPreview(null); router.refresh() } } catch { toast('Could not reach the server — nothing was imported', 'error') } finally { setBusy(false) } }
  return <section className={cardCls + ' mt-4'}><h2 className={sectionHeadCls}>Import ledger accounts</h2><p className="mt-1 text-sm text-stone-600">{contract} Preview checks the complete file and writes nothing.</p><textarea value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null) }} rows={7} spellCheck={false} className={inputCls + ' mt-3 min-h-36 w-full font-mono text-sm'} placeholder="code,name,type" />{preview !== null ? <p className="mt-2 text-sm text-green-700">Ready: {preview} accounts. Nothing has been written.</p> : null}<div className="mt-3 flex gap-2"><button type="button" disabled={busy || csv.trim() === ''} onClick={() => void previewFile()} className={btnCls}>{busy ? 'Checking…' : 'Preview import'}</button><button type="button" disabled={busy || preview === null} onClick={() => void commit()} className={btnCls}>{busy ? 'Importing…' : 'Commit import'}</button></div></section>
}
