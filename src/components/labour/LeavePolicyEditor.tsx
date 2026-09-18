'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { assignLeavePolicy, saveLeavePolicy } from '@/server/leave-actions'
import type { LeaveAssignmentRow, LeavePolicyRow } from '@/server/leave-queries'
import type { StaffRow } from '@/lib/types'
import { btnCls, cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'

export default function LeavePolicyEditor({ policies, assignments, staff }: { policies: LeavePolicyRow[]; assignments: LeaveAssignmentRow[]; staff: StaffRow[] }) {
  const router = useRouter()
  const [code, setCode] = useState(''); const [name, setName] = useState(''); const [annual, setAnnual] = useState(''); const [paid, setPaid] = useState(''); const [carry, setCarry] = useState(false)
  const [staffId, setStaffId] = useState(''); const [policyId, setPolicyId] = useState(''); const [from, setFrom] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [ack, setAck] = useState<string | null>(null)
  async function create() { setBusy(true); setError(null); try { const result = await saveLeavePolicy({ code, name, annualDays: annual, paidDays: paid, carryForward: carry, status: 'active' }); if (!result.ok) setError(result.error); else { setAck('Leave policy created'); setCode(''); setName(''); setAnnual(''); setPaid(''); router.refresh() } } finally { setBusy(false) } }
  async function assign() { setBusy(true); setError(null); try { const result = await assignLeavePolicy({ staffId, policyId, effectiveFrom: from }); if (!result.ok) setError(result.error); else { setAck('Leave policy assigned'); setStaffId(''); setPolicyId(''); setFrom(''); router.refresh() } } finally { setBusy(false) } }
  return <section className={`${cardCls} mt-4`}>
    <h2 className={sectionHeadCls}>Leave policies</h2>
    <p className="mt-1 text-sm text-stone-600">Configure the allowance explicitly. Payroll credits only the paid-leave days in the assigned policy; an unassigned person receives no paid-leave credit.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-5"><label><span className={fieldLabelCls}>Code</span><input value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} placeholder="CL" /></label><label className="sm:col-span-2"><span className={fieldLabelCls}>Name</span><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Casual leave" /></label><label><span className={fieldLabelCls}>Annual days</span><input inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} className={inputCls} /></label><label><span className={fieldLabelCls}>Paid days</span><input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} className={inputCls} /></label></div>
    <label className="mt-2 flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} /> Carry unused days forward (recorded policy flag)</label>
    <button type="button" disabled={busy || !code || !name || !annual || !paid} onClick={() => void create()} className={`${btnCls} mt-3`}>{busy ? 'Saving…' : 'Add policy'}</button>
    <div className="mt-5 border-t border-rule-soft pt-4"><h3 className="text-sm font-semibold text-stone-900">Assign policy to staff</h3><div className="mt-2 grid gap-3 sm:grid-cols-3"><label><span className={fieldLabelCls}>Staff</span><select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={selectCls}><option value="">Choose staff…</option>{staff.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label><label><span className={fieldLabelCls}>Policy</span><select value={policyId} onChange={(e) => setPolicyId(e.target.value)} className={selectCls}><option value="">Choose policy…</option>{policies.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label><label><span className={fieldLabelCls}>Effective from</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></label></div><button type="button" disabled={busy || !staffId || !policyId || !from} onClick={() => void assign()} className={`${btnCls} mt-3`}>{busy ? 'Saving…' : 'Assign policy'}</button></div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{ack !== null && <SaveAck headline={ack} sub="The leave configuration is now available to the payroll workflow." onDismiss={() => setAck(null)} />}
    {policies.length > 0 && <ul className="mt-4 divide-y divide-rule-soft text-sm">{policies.map((p) => <li key={p.id} className={`flex justify-between gap-2 py-2 ${p.status !== 'active' ? 'opacity-60 line-through' : ''}`}><span><b>{p.code}</b> · {p.name} · {p.paid_days}/{p.annual_days} paid days{p.carry_forward ? ' · carry-forward' : ''}{p.status !== 'active' && ' · retired'}</span><span className="text-xs text-stone-500">{p.assigned_staff} assigned</span></li>)}</ul>}
    {assignments.length > 0 && <p className="mt-3 text-xs text-stone-500">Assignment history: {assignments.map((a) => `${a.staff_id.slice(0, 8)} → ${a.policy_name} (${a.effective_from}${a.effective_to === null ? ' onward' : ` to ${a.effective_to}`})`).join(' · ')}</p>}
  </section>
}
