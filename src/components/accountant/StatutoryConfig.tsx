'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StatutoryConfigRow } from '@/server/statutory-queries'
import { saveStatutoryConfig } from '@/server/statutory-actions'
import { toast } from '@/components/Toasts'
import { btnCls, cardCls, fieldLabelCls, inputCls, sectionHeadCls } from '@/components/ui'

const fields = [
  ['pfEmployeePct', 'PF employee %'], ['pfEmployerPct', 'PF employer %'], ['pfWageCap', 'PF wage cap'],
  ['esiEmployeePct', 'ESI employee %'], ['esiEmployerPct', 'ESI employer %'], ['esiWageCap', 'ESI wage cap'],
] as const
type Form = Record<(typeof fields)[number][0], string> & { effectiveFrom: string; jurisdiction: string; tdsRegime: string; note: string }
const blank: Form = { effectiveFrom: '', jurisdiction: 'IN', pfEmployeePct: '', pfEmployerPct: '', pfWageCap: '', esiEmployeePct: '', esiEmployerPct: '', esiWageCap: '', tdsRegime: '', note: '' }

export default function StatutoryConfig({ rows }: { rows: StatutoryConfigRow[] }) {
  const router = useRouter(); const [form, setForm] = useState<Form>(blank); const [busy, setBusy] = useState(false)
  const set = (key: keyof Form, value: string) => setForm((f) => ({ ...f, [key]: value }))
  async function save() { if (busy) return; setBusy(true); try { const r = await saveStatutoryConfig(form); if (!r.ok) { toast(r.error, 'error'); return }; toast('Statutory configuration saved', 'ok'); setForm(blank); router.refresh() } catch { toast('Could not save statutory configuration', 'error') } finally { setBusy(false) } }
  return <section className={`${cardCls} mt-4`}>
    <h2 className={sectionHeadCls}>Statutory configuration</h2>
    <p className="mt-1.5 text-sm text-stone-700">Record the accountant-approved assumptions used for filing preparation. These values are evidence only: KitchenBooks does not calculate or submit PF, ESI, or TDS. The database migration must be applied before saving.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label><span className={fieldLabelCls}>Effective from</span><input type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} className={inputCls} /></label>
      <label><span className={fieldLabelCls}>Jurisdiction</span><input value={form.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)} maxLength={30} className={inputCls} /></label>
      {fields.map(([key, label]) => <label key={key}><span className={fieldLabelCls}>{label}</span><input inputMode="decimal" value={form[key]} onChange={(e) => set(key, e.target.value)} placeholder="leave blank if not applicable" className={inputCls} /></label>)}
      <label><span className={fieldLabelCls}>TDS regime / filing note</span><input value={form.tdsRegime} onChange={(e) => set('tdsRegime', e.target.value)} maxLength={80} className={inputCls} /></label>
      <label><span className={fieldLabelCls}>Source / accountant note</span><input value={form.note} onChange={(e) => set('note', e.target.value)} maxLength={300} className={inputCls} /></label>
    </div>
    <button type="button" disabled={busy || form.effectiveFrom === ''} onClick={() => void save()} className={`${btnCls} mt-3`}>{busy ? 'Saving…' : 'Save configuration'}</button>
    {rows.length > 0 && <div className="mt-4 border-t border-rule-soft pt-3"><p className="text-xs font-medium text-stone-500">Recorded history</p><ul className="mt-1 divide-y divide-rule-soft text-sm">{rows.map((r) => <li key={r.id} className="py-2"><span className="font-mono">{r.effective_from}</span> · {r.jurisdiction}{r.tds_regime && ` · TDS: ${r.tds_regime}`}{r.note && ` · ${r.note}`} · entered by {r.entered_by}</li>)}</ul></div>}
  </section>
}
