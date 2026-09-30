'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { savePosStockPolicy } from '@/server/settings-actions'
import { btnCls, cardCls, fieldLabelCls, sectionHeadCls, selectCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'
export default function PosStockPolicyEditor({ policy }: { policy: 'none' | 'reconcile' }) {
  const router = useRouter(); const [value, setValue] = useState(policy); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [ack, setAck] = useState(false)
  async function save() { setBusy(true); setError(null); try { const result = await savePosStockPolicy(value); if (!result.ok) setError(result.error); else { setAck(true); router.refresh() } } catch { setError('Could not reach the server — nothing was changed.') } finally { setBusy(false) } }
  return <section className={cardCls}><h2 className={sectionHeadCls}>POS stock policy</h2><p className="mt-1 text-sm text-stone-600">Reconciliation compares mapped POS recipe sales with kitchen consumption views. It never silently edits lots or stock; store issues remain the stock source of truth.</p><label className="mt-3 block"><span className={fieldLabelCls}>Policy</span><select value={value} onChange={(e) => setValue(e.target.value as 'none' | 'reconcile')} className={selectCls}><option value="reconcile">Reconcile POS sales in kitchen views</option><option value="none">Do not reconcile POS sales</option></select></label>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}<button type="button" disabled={busy} onClick={() => void save()} className={`${btnCls} mt-3`}>{busy ? 'Saving…' : 'Save POS stock policy'}</button>{ack && <SaveAck headline="POS stock policy updated" sub={value === 'reconcile' ? 'Mapped POS sales will be compared with kitchen consumption.' : 'POS reconciliation is off; store issues remain the stock source of truth.'} onDismiss={() => setAck(false)} />}</section>
}
