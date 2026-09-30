'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveStockAdjustmentApprovalMode } from '@/server/settings-actions'
import SaveAck from '@/components/SaveAck'
import { btnCls, cardCls, fieldLabelCls, sectionHeadCls, selectCls } from '@/components/ui'

export default function StockAdjustmentApprovalEditor({ mode }: { mode: 'none' | 'owner' }) {
  const router = useRouter()
  const [current, setCurrent] = useState(mode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState(false)
  async function save() {
    setBusy(true); setError(null)
    try {
      const result = await saveStockAdjustmentApprovalMode(current)
      if (result.ok) { setAck(true); router.refresh() }
      else setError(result.error)
    } catch { setError('Could not reach the server — nothing was changed.') }
    finally { setBusy(false) }
  }
  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3"><h2 className={sectionHeadCls}>Stock correction approvals</h2><span className="font-mono text-[11px] text-stone-400">settings</span></div>
      <p className="mt-1 text-sm text-stone-600">Count acceptance is always deliberate. This rule controls standalone corrections such as opening stock, spoilage, and found stock.</p>
      <label className="mt-3 block sm:max-w-md"><span className={fieldLabelCls}>Who may post a standalone correction?</span><select value={current} onChange={(e) => setCurrent(e.target.value as 'none' | 'owner')} className={selectCls}><option value="none">Authorized store, manager, or owner</option><option value="owner">Owner approval required</option></select></label>
      {error !== null && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <button type="button" onClick={() => void save()} disabled={busy} className={`${btnCls} mt-3 disabled:bg-stone-300`}>{busy ? 'Saving…' : 'Save stock approval rule'}</button>
      {ack && <SaveAck headline="Stock correction rule updated" sub={current === 'owner' ? 'Standalone corrections now wait for owner approval.' : 'Authorized store, manager, and owner staff may post corrections.'} onDismiss={() => setAck(false)} />}
    </section>
  )
}
