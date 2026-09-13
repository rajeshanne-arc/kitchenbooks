'use client'

import { useRef, useState } from 'react'
import { attachPhoto } from '@/server/attachments-actions'
import { compressImage } from '@/lib/compress'
import { btnGhostCls } from '@/components/ui'
import ArchiveAttachment from '@/components/documents/ArchiveAttachment'

type Row = { id: string; filename: string | null; byte_size: number | null; status?: 'active' | 'archived' }

export default function MeterPhotos({ readingId, canArchive }: { readingId: string; canArchive: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function upload(file: File | undefined) {
    if (!file || busy) return
    setBusy(true); setMessage(null)
    try {
      const compressed = await compressImage(file)
      const form = new FormData()
      form.set('entity', 'meter_reading'); form.set('entityId', readingId)
      form.set('contentType', compressed.file.type); form.set('filename', compressed.file.name); form.set('file', compressed.file)
      const result = await attachPhoto(form)
      if (!result.ok) { setMessage(result.error); return }
      setRows((current) => [...current, { id: result.id, filename: compressed.file.name, byte_size: compressed.after, status: 'active' }])
      setMessage('Evidence photo attached.')
    } catch { setMessage('The photo could not be attached. The meter reading is already saved.') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }

  return <div className="mt-3 border-t border-rule-soft pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-stone-600">Optional evidence for this reading</p>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={btnGhostCls}>{busy ? 'Uploading…' : 'Attach meter photo'}</button>
    </div>
    {rows.length > 0 && <ul className="mt-2 space-y-1 text-xs text-stone-600">{rows.map((row) => <li key={row.id} className="flex items-center justify-between gap-2"><span><a href={`/api/attachments/${row.id}`} target="_blank" rel="noreferrer" className="text-emerald-800 underline">{row.filename ?? 'Meter evidence'}</a>{row.byte_size === null ? '' : ` · ${Math.max(1, Math.round(row.byte_size / 1024))} KB`}</span><ArchiveAttachment id={row.id} archived={row.status === 'archived'} canArchive={canArchive} /></li>)}</ul>}
    {message && <p className="mt-2 text-xs text-stone-600">{message}</p>}
  </div>
}
