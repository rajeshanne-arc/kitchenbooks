'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveSalaryStructure } from '@/server/salary-actions'
import type { StaffIdentity } from '@/lib/types'
import { formatMoneyString } from '@/lib/money'
import { btnCls, cardCls, fieldLabelCls, inputCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function SalaryStructures({ staff }: { staff: StaffIdentity[] }) {
  const router = useRouter(); const [person, setPerson] = useState(''); const [date, setDate] = useState(''); const [salary, setSalary] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const selected = staff.find((s) => s.id === person)
  async function save() { if (!selected || busy) return; setBusy(true); try { const result = await saveSalaryStructure({ staffId: person, effectiveFrom: date, baseSalary: salary, note }); if (result.ok) { toast(`Salary structure saved for ${selected.name}`); setDate(''); setSalary(''); setNote(''); router.refresh() } else toast(result.error, 'error') } finally { setBusy(false) } }
  return <section className={`${cardCls} mt-4`}><h2 className={sectionHeadCls}>Salary structures</h2><p className="mt-1 text-sm text-stone-600">Effective-dated salary records are used for future payroll drafts. Existing paid runs never change.</p><div className="mt-3 grid gap-3 sm:grid-cols-4"><label><span className={fieldLabelCls}>Person</span><select aria-label="Person" value={person} onChange={(e) => setPerson(e.target.value)} className={inputCls}><option value="">Choose…</option>{staff.filter((s) => s.employment_type !== 'contract').map((s) => <option key={s.id} value={s.id}>{s.name} · current {s.base_salary ? formatMoneyString(s.base_salary) : 'not set'}</option>)}</select></label><label><span className={fieldLabelCls}>Effective from</span><input aria-label="Effective from" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls}/></label><label><span className={fieldLabelCls}>Monthly base salary</span><input aria-label="Monthly base salary" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} className={inputCls}/></label><label><span className={fieldLabelCls}>Note</span><input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} className={inputCls}/></label></div><button type="button" disabled={busy || !selected || !date || !salary} onClick={() => void save()} className={`${btnCls} mt-3 disabled:bg-stone-300`}>{busy ? 'Saving…' : 'Save salary structure'}</button></section>
}
