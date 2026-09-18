'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLeaveRequest, decideLeaveRequest, recordLeaveCarryForward } from '@/server/leave-request-actions'
import { toast } from '@/components/Toasts'

type Staff = { id: string; code: string; name: string }
type Policy = { id: string; code: string; name: string }
type Request = { id: string; staff_code: string; staff_name: string; policy_name: string | null; start_date: string; end_date: string; requested_days: string; status: string; note: string | null; requested_by: string; decided_by: string | null }
type Balance = { staff_id: string; staff_code: string; staff_name: string; allowance: string; carry_forward: string; carry_forward_source: 'ledger' | 'suggested' | 'none'; approved_days: string; remaining: string }

export default function LeaveRequestsPanel({ staff, policies, requests, balances, year, canRecordCarryForward }: { staff: Staff[]; policies: Policy[]; requests: Request[]; balances: Balance[]; year: number; canRecordCarryForward: boolean }) {
  const router = useRouter()
  const [staffId, setStaffId] = useState('')
  const [policyId, setPolicyId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [carryStaffId, setCarryStaffId] = useState('')
  const [carryDays, setCarryDays] = useState('')
  const [carryNote, setCarryNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true); setError(null)
    const r = await createLeaveRequest({ staffId, policyId, startDate: start, endDate: end, note })
    setBusy(false)
    if (!r.ok) setError(r.error)
    else { toast('Leave request recorded'); setStart(''); setEnd(''); setNote(''); router.refresh() }
  }

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusy(true); setError(null)
    const r = await decideLeaveRequest(id, decision, '')
    setBusy(false)
    if (!r.ok) setError(r.error)
    else { toast(`Leave ${decision}`); router.refresh() }
  }

  async function recordCarry() {
    setBusy(true); setError(null)
    const r = await recordLeaveCarryForward({ staffId: carryStaffId, sourceYear: year - 1, carriedDays: carryDays, note: carryNote })
    setBusy(false)
    if (!r.ok) setError(r.error)
    else { toast(`Carry-forward recorded for ${year}`); setCarryDays(''); setCarryNote(''); router.refresh() }
  }

  return <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
    <h2 className="font-display text-xl font-bold text-stone-900">Leave requests and approvals</h2>
    <p className="mt-1 text-sm text-stone-600">Approval writes leave into attendance. A present or half-day mark blocks approval until the facts are resolved.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-5">
      <select aria-label="Leave staff" value={staffId} onChange={e => setStaffId(e.target.value)} className="rounded-xl border border-stone-300 px-3 py-2"><option value="">Person…</option>{staff.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select>
      <select aria-label="Leave policy" value={policyId} onChange={e => setPolicyId(e.target.value)} className="rounded-xl border border-stone-300 px-3 py-2"><option value="">Policy…</option>{policies.filter(p => p.id).map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>
      <input aria-label="Leave start" type="date" value={start} onChange={e => setStart(e.target.value)} className="rounded-xl border border-stone-300 px-3 py-2" />
      <input aria-label="Leave end" type="date" value={end} onChange={e => setEnd(e.target.value)} className="rounded-xl border border-stone-300 px-3 py-2" />
      <button type="button" disabled={busy || !staffId || !policyId || !start || !end} onClick={() => void save()} className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-stone-300">{busy ? 'Saving…' : 'Record request'}</button>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    <h3 className="mt-4 text-sm font-semibold text-stone-800">Balance · {year}</h3>
    <ul className="mt-1 grid gap-1 text-sm text-stone-700 sm:grid-cols-2">{balances.map(b => <li key={b.staff_id} className="flex justify-between gap-3 border-b border-stone-100 py-1"><span>{b.staff_code} · {b.staff_name}</span><span>{b.approved_days}/{b.allowance} + {b.carry_forward} carried{b.carry_forward_source === 'ledger' ? ' (recorded)' : b.carry_forward_source === 'suggested' ? ' (suggested)' : ''} · {b.remaining} remaining</span></li>)}</ul>
    {canRecordCarryForward && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <h3 className="text-sm font-semibold text-amber-950">Record {year - 1} → {year} carry-forward</h3>
      <p className="mt-1 text-xs text-amber-900">Use the suggested balance above after the accountant has reviewed the prior year. This creates an immutable ledger entry; it does not change past leave requests.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <select aria-label="Carry-forward staff" value={carryStaffId} onChange={e => setCarryStaffId(e.target.value)} className="rounded-xl border border-amber-300 bg-white px-3 py-2"><option value="">Person…</option>{staff.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select>
        <input aria-label="Carried days" inputMode="decimal" placeholder="Days" value={carryDays} onChange={e => setCarryDays(e.target.value)} className="rounded-xl border border-amber-300 bg-white px-3 py-2" />
        <input aria-label="Carry-forward note" placeholder="Review note" value={carryNote} onChange={e => setCarryNote(e.target.value)} className="rounded-xl border border-amber-300 bg-white px-3 py-2" />
        <button type="button" disabled={busy || !carryStaffId || !carryDays} onClick={() => void recordCarry()} className="rounded-xl bg-amber-800 px-3 py-2 text-sm font-semibold text-white disabled:bg-stone-300">{busy ? 'Saving…' : 'Record carry-forward'}</button>
      </div>
    </div>}
    <ul className="mt-4 divide-y divide-stone-100">{requests.slice(0, 20).map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span><b>{r.staff_code} · {r.staff_name}</b> · {r.start_date} — {r.end_date} · {r.requested_days} days · {r.policy_name ?? 'unassigned'}<span className="ml-2 text-xs text-stone-500">{r.status}</span></span>{r.status === 'pending' && <span className="flex gap-2"><button type="button" disabled={busy} onClick={() => void decide(r.id, 'approved')} className="text-emerald-700 underline">Approve</button><button type="button" disabled={busy} onClick={() => void decide(r.id, 'rejected')} className="text-red-700 underline">Reject</button></span>}</li>)}</ul>
  </section>
}
