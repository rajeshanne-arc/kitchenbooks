'use client'

// DISCARD, for a master that lives as a ROW in a list rather than on a page of
// its own — a money account, a meter, a storage location, a list value.
//
// MasterActions is a whole card and belongs on a detail page. Dropping one into
// a table row would be worse than useless. But the preview is not decoration
// that can be dropped with it: the owner is still being asked to approve
// something that leaves nothing behind, so this expands INLINE into the same
// three things — what points at it, whether it can be closed, and why.
//
// NONE OF THESE FOUR CAN BE MERGED, and that is a fact about the schema rather
// than a policy: only items, vendors and recipes carry `merged_into` and have a
// merge_* function, so only they have somewhere to point after they close.
// Offering a merge here would be offering a button whose action does not exist.

import { useState } from 'react'
import Honesty from '@/components/Honesty'
import { previewChange, requestApproval } from '@/server/approvals-actions'
import type { ApprovalEntity, Preview } from '@/server/approvals-queries'
import { btnCls, btnGhostCls, fieldLabelCls, inputCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function DiscardControl({
  entity,
  id,
  label,
  noun,
  onDone,
}: {
  entity: ApprovalEntity
  id: string
  /** what to call this row in the sentences */
  label: string
  noun: string
  onDone?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function start() {
    setOpen(true)
    setError(null)
    const r = await previewChange({ kind: 'discard', entity, fromId: id, toId: '' })
    if (r.ok) setPreview(r.preview)
    else setError(r.error)
  }

  async function send() {
    setBusy(true)
    const r = await requestApproval({ kind: 'discard', entity, fromId: id, toId: '', reason: reason.trim() })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setSent(true)
    toast(r.message)
    onDone?.()
  }

  if (sent) {
    return (
      <span className="text-[13px] text-emerald-800">
        Sent to the owner — nothing has changed yet.
      </span>
    )
  }

  if (!open) {
    return (
      <button type="button" onClick={() => void start()} className="text-[13px] text-stone-500 underline">
        Discard…
      </button>
    )
  }

  const blocked = preview?.checks.filter((c) => !c.ok) ?? []
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-rule bg-stone-50 p-3">
      <p className="text-[13px] text-stone-600">
        <span className="font-medium text-stone-800">Discarding</span> says this {noun} was never real —
        different from retiring it, which says we stopped using it and keeps everything it touched. The
        owner decides.
      </p>

      {error !== null && (
        <Honesty verdict="Cannot be asked" level="alarm" compact>
          {error}
        </Honesty>
      )}

      {preview !== null && (
        <>
          <p className="text-[13px] text-stone-700">
            {preview.totalRefs === 0
              ? `Nothing anywhere points at ${label}.`
              : `${preview.totalRefs} row(s) point at ${label}: ${preview.refs
                  .map((r) => `${r.referencing_table} ${r.n}${r.pointer ? ' (merge pointer)' : ''}`)
                  .join(' · ')}`}
          </p>
          {blocked.length > 0 ? (
            <Honesty verdict="Cannot be discarded" level="alarm" compact>
              {blocked[0].detail}
            </Honesty>
          ) : (
            <>
              <label className="block">
                <span className={fieldLabelCls}>Why? (required)</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. added twice while setting up"
                  className={inputCls}
                  maxLength={300}
                  autoFocus
                />
              </label>
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || reason.trim() === ''}
                className={btnCls}
              >
                {busy ? 'Sending…' : 'Ask the owner'}
              </button>
            </>
          )}
        </>
      )}

      <button type="button" onClick={() => setOpen(false)} className={btnGhostCls}>
        Cancel
      </button>
    </div>
  )
}
