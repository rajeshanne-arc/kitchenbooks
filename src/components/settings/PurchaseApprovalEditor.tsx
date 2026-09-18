'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { savePurchaseApprovalSettings } from '@/server/settings-actions'
import SaveAck from '@/components/SaveAck'
import { btnCls, cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'

export default function PurchaseApprovalEditor({ mode, threshold }: { mode: 'none' | 'threshold'; threshold: string }) {
  const router = useRouter()
  const [currentMode, setCurrentMode] = useState(mode)
  const [currentThreshold, setCurrentThreshold] = useState(threshold)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const result = await savePurchaseApprovalSettings(currentMode, currentThreshold)
      if (result.ok) {
        setAck(true)
        router.refresh()
      } else setError(result.error)
    } catch {
      setError('Could not reach the server — nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Purchase approvals</h2>
        <span className="font-mono text-[11px] text-stone-400">settings</span>
      </div>
      <p className="mt-1 text-sm text-stone-600">
        Orders at or above the threshold are frozen and sent to the owner queue. Approval does not contact the vendor; the purchaser still sends the approved order.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabelCls}>Approval rule</span>
          <select value={currentMode} onChange={(e) => setCurrentMode(e.target.value as 'none' | 'threshold')} className={selectCls}>
            <option value="none">No approval required</option>
            <option value="threshold">Require owner approval by amount</option>
          </select>
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Threshold (₹)</span>
          <input value={currentThreshold} onChange={(e) => setCurrentThreshold(e.target.value)} inputMode="decimal" className={inputCls} disabled={currentMode === 'none'} />
        </label>
      </div>
      {error !== null && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <button type="button" onClick={() => void save()} disabled={busy} className={`${btnCls} mt-3 disabled:bg-stone-300`}>
        {busy ? 'Saving…' : 'Save purchase approval rule'}
      </button>
      {ack && <SaveAck headline="Purchase approval rule updated" sub={currentMode === 'none' ? 'Orders can now proceed without owner approval.' : `Orders at or above ₹${currentThreshold} will wait in the owner queue.`} onDismiss={() => setAck(false)} />}
    </section>
  )
}
