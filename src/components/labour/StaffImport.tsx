'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { importStaffCsv, previewStaffCsv } from '@/server/staff-import'
import { btnCls, cardCls, inputCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function StaffImport({ contract }: { contract: string }) {
  const router = useRouter(); const [csv, setCsv] = useState(''); const [busy, setBusy] = useState(false); const [preview, setPreview] = useState<{ count: number; firstCodes: string[]; sections: number } | null>(null); const [error, setError] = useState<string | null>(null)
  async function inspect() { if (busy) return; setBusy(true); setError(null); const result = await previewStaffCsv({ csv }); setBusy(false); if (!result.ok) setError(result.error); else setPreview(result) }
  async function submit() { if (busy || preview === null) return; setBusy(true); const result = await importStaffCsv({ csv }); setBusy(false); if (!result.ok) setError(result.error); else { toast(`${result.count} staff imported`, 'ok'); setCsv(''); setPreview(null); router.refresh() } }
  return <section className={`${cardCls} mt-4`}><h2 className={sectionHeadCls}>Import staff</h2><p className="mt-1 text-sm text-stone-600">{contract} Every row is validated, including section references, before one atomic roster insert. No bank or statutory identifiers are accepted in this file.</p><textarea value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null) }} rows={8} spellCheck={false} className={`${inputCls} mt-3 min-h-40 w-full font-mono text-sm`} placeholder="name,designation,section,employment_type,base_salary,pay_mode,joined,phone,status" />{error && <p className="mt-2 text-sm text-red-700">{error}</p>}{preview && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Preview passed: {preview.count} staff rows; next codes {preview.firstCodes.join(', ')}{preview.count > 5 ? '…' : ''}. Nothing has been written.</p>}<div className="mt-3 flex gap-2"><button type="button" disabled={busy || csv.trim() === ''} onClick={() => void inspect()} className={`${btnCls}`}>{busy ? 'Checking…' : 'Preview import'}</button><button type="button" disabled={busy || preview === null} onClick={() => void submit()} className={`${btnCls} disabled:bg-stone-300`}>{busy ? 'Importing…' : 'Commit import'}</button></div></section>
}
