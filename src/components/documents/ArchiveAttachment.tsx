'use client'

import { useState } from 'react'
import { archiveAttachment } from '@/server/attachment-actions'
import { btnGhostCls } from '@/components/ui'

export default function ArchiveAttachment({ id, archived = false, canArchive }: { id: string; archived?: boolean; canArchive: boolean }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [retentionUntil, setRetentionUntil] = useState('')

  async function archive() {
    if (busy || archived || !window.confirm('Archive this evidence? It will remain readable for audit.')) return
    setBusy(true)
    setMessage(null)
    const result = await archiveAttachment({ id, retentionUntil })
    if (result.ok) setMessage('Archived')
    else setMessage(result.error)
    setBusy(false)
  }

  if (archived || message === 'Archived') return <span className="shrink-0 text-xs text-stone-500">Archived</span>
  if (!canArchive) return null
  return (
    <span className="flex shrink-0 items-center gap-2">
      <label className="sr-only" htmlFor={`retention-${id}`}>Retention date</label>
      <input id={`retention-${id}`} type="date" value={retentionUntil} onChange={(event) => setRetentionUntil(event.target.value)} className="rounded border border-rule-soft px-1.5 py-1 text-xs text-stone-600" title="Optional retention date" />
      <button type="button" disabled={busy} onClick={() => void archive()} className={btnGhostCls}>
        {busy ? 'Archiving…' : 'Archive'}
      </button>
      {message && <span className="text-xs text-red-800">{message}</span>}
    </span>
  )
}
