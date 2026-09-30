'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveHoliday } from '@/server/holiday-actions'
import type { HolidayRow } from '@/server/holiday-queries'
import { cardCls, fieldLabelCls, inputCls, selectCls, sectionHeadCls } from '@/components/ui'
import { fmtDate } from '@/lib/format'
import SaveAck from '@/components/SaveAck'

export default function HolidayEditor({ holidays }: { holidays: HolidayRow[] }) {
  const router = useRouter(); const [date, setDate] = useState(''); const [name, setName] = useState(''); const [paid, setPaid] = useState('true'); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [ack, setAck] = useState(false)
  async function save() { if (busy) return; setBusy(true); setError(null); try { const result = await saveHoliday({ date, name, paid: paid === 'true' }); if (result.ok) { setAck(true); setDate(''); setName(''); router.refresh() } else setError(result.error) } finally { setBusy(false) } }
  return <section className={`${cardCls} mt-4`}><h2 className={sectionHeadCls}>Holiday calendar</h2><p className="mt-1 text-sm text-stone-600">Paid holidays count as paid days in future payroll drafts unless attendance for that person is explicitly marked.</p><div className="mt-3 grid gap-3 sm:grid-cols-3"><label><span className={fieldLabelCls}>Date</span><input aria-label="Holiday date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls}/></label><label><span className={fieldLabelCls}>Holiday name</span><input aria-label="Holiday name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls}/></label><label><span className={fieldLabelCls}>Pay treatment</span><select aria-label="Pay treatment" value={paid} onChange={(e) => setPaid(e.target.value)} className={selectCls}><option value="true">Paid holiday</option><option value="false">Unpaid holiday</option></select></label></div>{error && <p className="mt-2 text-sm text-red-700">{error}</p>}<button type="button" disabled={busy || !date || name.trim() === ''} onClick={() => void save()} className="mt-3 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-stone-300">{busy ? 'Saving…' : 'Add holiday'}</button>{ack && <SaveAck headline="Holiday added" sub="The holiday is now part of future payroll calculations." onDismiss={() => setAck(false)} />}{holidays.length > 0 && <ul className="mt-3 divide-y divide-rule-soft">{holidays.slice(0, 24).map((h) => <li key={h.id} className="flex justify-between gap-2 py-2 text-sm"><span>{fmtDate(h.holiday_date)} · {h.name}<span className="ml-2 text-xs text-stone-500">{h.paid ? 'paid' : 'unpaid'}</span></span><span className="text-xs text-stone-400">{h.entered_by}</span></li>)}</ul>}</section>
}
