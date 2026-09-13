'use client'

// SEND, CANCEL, CLOSE — and the WhatsApp hand-off.
//
// THE SEND IS TWO STEPS AND THAT IS THE FEATURE. Pressing Send records that
// the order was handed over and opens WhatsApp with the message already
// written; a person reads it and presses send there. A document involving
// money should be seen before it goes, and this app can never verify that a
// vendor understood it — an automated send would buy a receipt and lose the
// reading.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cancelPurchaseOrder, closePurchaseOrder, requestPurchaseOrderApproval, sendPurchaseOrder } from '@/server/po-actions'
import { toast } from '@/components/Toasts'
import SaveAck from '@/components/SaveAck'
import Honesty from '@/components/Honesty'
import { btnCls, btnGhostCls, inputCls } from '@/components/ui'
import type { PoApprovalStatus, PoStatus } from '@/lib/types'

export default function PoActions({
  id,
  status,
  approvalStatus,
  docNo,
  vendorName,
  waHref,
  printHref,
}: {
  id: string
  status: PoStatus
  approvalStatus: PoApprovalStatus
  docNo: string | null
  vendorName: string
  /** null when the vendor has no usable phone number — the button is replaced
   *  by the reason, never rendered as a dead link. */
  waHref: string | null
  printHref: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [approvalReason, setApprovalReason] = useState('')
  const [requestingApproval, setRequestingApproval] = useState(false)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)

  async function run(p: Promise<{ ok: true } | { ok: false; error: string }>, done: () => void) {
    setBusy(true)
    setError(null)
    try {
      const res = await p
      if (res.ok) {
        done()
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  const send = (via: 'whatsapp' | 'print') =>
    run(sendPurchaseOrder({ id, via }), () => {
      setAck({
        headline: `${docNo ?? 'Order'} marked sent to ${vendorName}`,
        sub:
          via === 'whatsapp'
            ? 'WhatsApp is opening with the message written — read it and press send there. It is recorded as sent because it left here; whether it was read is the vendor’s to say.'
            : 'Recorded as sent by print. What was ordered is now what a short is measured against, so the order is frozen — cancel it and raise a new one if it is wrong.',
      })
      if (via === 'whatsapp' && waHref !== null) window.open(waHref, '_blank', 'noopener')
    })

  async function requestApproval() {
    if (approvalReason.trim() === '') return
    setRequestingApproval(true)
    setError(null)
    try {
      const res = await requestPurchaseOrderApproval(id, approvalReason)
      if (res.ok) {
        setApprovalReason('')
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was changed.')
    } finally {
      setRequestingApproval(false)
    }
  }

  return (
    <div className="space-y-3">
      {ack !== null && <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />}
      {error !== null && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {status === 'draft' && waHref === null && (
        <Honesty verdict="nowhere to send it" level="alarm">
          {vendorName} has no phone number, so this cannot go over WhatsApp. Add one on the vendor, or send it
          by print and record that.
        </Honesty>
      )}

      {status === 'draft' && approvalStatus === 'pending' && (
        <Honesty verdict="waiting for owner approval" level="pending">
          This order is frozen until an owner approves or refuses it. Nothing has been sent to the vendor yet.
        </Honesty>
      )}

      {status === 'draft' && approvalStatus === 'approved' && (
        <Honesty verdict="approved — ready to send" level="pending">
          An owner approved this order. It is still not sent; choose WhatsApp or print below to record the vendor hand-off.
        </Honesty>
      )}

      <div className="flex flex-wrap gap-2">
        {status === 'draft' && approvalStatus !== 'pending' && (
          <>
            {waHref !== null && (
              <button type="button" disabled={busy} onClick={() => void send('whatsapp')} className={btnCls}>
                {busy ? 'Sending…' : 'Send on WhatsApp'}
              </button>
            )}
            <a href={printHref} target="_blank" rel="noopener" className={btnGhostCls}>
              Preview the document
            </a>
            <button type="button" disabled={busy} onClick={() => void send('print')} className={btnGhostCls}>
              Mark sent by print
            </button>
          </>
        )}
        {status === 'draft' && approvalStatus !== 'pending' && approvalStatus !== 'approved' && (
          <button type="button" onClick={() => setRequestingApproval(true)} disabled={busy} className={btnGhostCls}>
            Request owner approval
          </button>
        )}
        {(status === 'sent' || status === 'received') && (
          <>
            {waHref !== null && (
              <a href={waHref} target="_blank" rel="noopener" className={btnGhostCls}>
                Send it again on WhatsApp
              </a>
            )}
            <a href={printHref} target="_blank" rel="noopener" className={btnGhostCls}>
              Print
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(closePurchaseOrder(id), () => toast(`${docNo ?? 'Order'} closed — no more is expected`, 'ok'))}
              className={btnGhostCls}
            >
              Close it — nothing more is coming
            </button>
          </>
        )}
        {status !== 'cancelled' && status !== 'received' && status !== 'closed' && !cancelling && (
          <button type="button" onClick={() => setCancelling(true)} className={btnGhostCls}>
            Cancel this order
          </button>
        )}
      </div>

      {requestingApproval && status === 'draft' && approvalStatus !== 'pending' && approvalStatus !== 'approved' && (
        <div className="rounded-xl border border-amber-300 bg-field p-3">
          <p className="text-sm text-stone-800">The order will be frozen while the owner decides. It will not be sent yet.</p>
          <input value={approvalReason} onChange={(e) => setApprovalReason(e.target.value)} maxLength={300} placeholder="Why is this purchase needed?" className={`${inputCls} mt-2`} />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || approvalReason.trim() === ''} onClick={() => void requestApproval()} className={`${btnCls} disabled:bg-stone-300`}>Send for approval</button>
            <button type="button" onClick={() => setRequestingApproval(false)} className={btnGhostCls}>Keep editing</button>
          </div>
        </div>
      )}

      {cancelling && (
        <div className="rounded-xl border border-amber-300 bg-field p-3">
          <p className="text-sm text-stone-800">
            {/* CANCEL IS THE ONLY CORRECTION ONCE IT HAS GONE OUT, and the
                honest one: it says "ignore that order", where an edit would
                say "you misread it" to somebody holding a copy. */}
            Cancelling keeps the order and its number on the record and stops anything being measured against
            it. {status === 'sent' && 'The vendor is holding a copy, so tell them too — this only changes our books.'}
          </p>
          <label className="mt-2 block">
            <span className="mb-1 block text-xs font-medium text-stone-500">Why? This is kept.</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} maxLength={300} />
          </label>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || reason.trim() === ''}
              onClick={() =>
                void run(cancelPurchaseOrder(id, reason), () => {
                  toast(`${docNo ?? 'Order'} cancelled — it keeps its number`, 'ok')
                  setCancelling(false)
                })
              }
              className={`${btnCls} disabled:bg-stone-300`}
            >
              Cancel the order
            </button>
            <button type="button" onClick={() => setCancelling(false)} className={btnGhostCls}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
