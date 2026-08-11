'use client'

// Contract bills and casual labour — the two kinds of labour that are not
// on the roster. Both feed the P&L's labour line, which counted only
// salaried staff until these existed, and so understated what labour costs.
//
// THE DRAWER RULE, and it is checkable rather than a habit:
// day_close_ladder reads cash_vouchers and does NOT read either of these
// tables. Money paid out of the till and recorded only here would leave the
// drawer short at close with nothing to explain it. So till cash is refused
// by name, exactly as on an expense, and the form says where it belongs.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CasualLabourRow, ContractBillRow, Section } from '@/lib/types'
import {
  saveCasualLabour,
  saveContractBill,
  voidCasualLabour,
  voidContractBill,
} from '@/server/expenses-actions'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate, todayLocal } from '@/lib/format'
import {
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  selectCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import { toast } from '@/components/Toasts'

const clean = (s: string) => s.replace(/[^\d.]/g, '')

function DrawerNote() {
  return (
    <p className="mt-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
      Paid from the drawer? That is a Cash Voucher — record it on the Cash page, where the day&apos;s ladder can
      see it. Recorded here alone, the till would come up short at close with nothing to explain it.
    </p>
  )
}

export function ContractBillsClient({
  modes,
  rows,
}: {
  modes: string[]
  rows: ContractBillRow[]
}) {
  const router = useRouter()
  const nonCash = modes.filter((m) => m.toLowerCase() !== 'cash')
  const [f, setF] = useState({
    date: todayLocal(),
    vendorName: '',
    service: '',
    headcount: '',
    periodStart: '',
    periodEnd: '',
    amount: '',
    paidVia: '',
    note: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))

  const canSave =
    !busy && f.vendorName.trim() !== '' && f.paidVia !== '' && parseMoney(f.amount.trim()) !== null

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await saveContractBill(f)
      if (res.ok) {
        toast(`${res.bill.vendor_name} — ${formatMoneyString(res.bill.amount)} recorded`)
        setF((s) => ({ ...s, vendorName: '', service: '', headcount: '', amount: '', note: '' }))
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Record a contract bill</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          Security, housekeeping, any agency that bills you for people. Their cost is labour, not an expense —
          the P&amp;L counts it on the labour line.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={fieldLabelCls}>Bill date</span>
            <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} className={`${numCls} w-full`} />
          </label>
          <label className="block sm:col-span-2">
            <span className={fieldLabelCls}>Agency</span>
            <input value={f.vendorName} onChange={(e) => set('vendorName', e.target.value)} placeholder="who billed you" className={inputCls} maxLength={120} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Service</span>
            <input value={f.service} onChange={(e) => set('service', e.target.value)} placeholder="security, housekeeping…" className={inputCls} maxLength={80} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Headcount</span>
            <input value={f.headcount} onChange={(e) => set('headcount', e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={`${numCls} w-full text-right font-mono tabular-nums`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Amount (₹)</span>
            <input value={f.amount} onChange={(e) => set('amount', clean(e.target.value))} inputMode="decimal" placeholder="0.00" className={`${numCls} w-full text-right font-mono tabular-nums`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Period from</span>
            <input type="date" value={f.periodStart} onChange={(e) => set('periodStart', e.target.value)} className={`${numCls} w-full`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>to</span>
            <input type="date" value={f.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} className={`${numCls} w-full`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Paid via</span>
            <select value={f.paidVia} onChange={(e) => set('paidVia', e.target.value)} className={selectCls}>
              <option value="">—</option>
              {nonCash.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-3">
            <span className={fieldLabelCls}>Note</span>
            <input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
          </label>
        </div>
        <DrawerNote />
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
        >
          {busy ? 'Saving…' : 'Record contract bill'}
        </button>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Recent contract bills</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">
            Nothing yet. Until an agency bill is here, the P&amp;L&apos;s labour line counts only salaried staff.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Agency</th>
                  <th className={thCls}>Service</th>
                  <th className={thNumCls}>People</th>
                  <th className={thNumCls}>Amount</th>
                  <th className={thCls}>
                    <span className="sr-only">Void</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`${trCls} ${r.is_reversal ? 'opacity-60' : ''}`}>
                    <td className={tdCls}>{fmtDate(r.bill_date)}</td>
                    <td className={tdCls}>
                      {r.vendor_name}
                      {r.is_voided && (
                        <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                          voided
                        </span>
                      )}
                    </td>
                    <td className={`${tdCls} text-stone-500`}>{r.service ?? '—'}</td>
                    <td className={`${tdNumCls} text-stone-500`}>{r.headcount ?? '—'}</td>
                    <td className={`${tdNumCls} font-semibold`}>{formatMoneyString(r.amount)}</td>
                    <td className={`${tdCls} text-right`}>
                      {!r.is_reversal && !r.is_voided && (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await voidContractBill(r.id)
                            if (res.ok) {
                              toast('Bill voided')
                              router.refresh()
                            } else toast(res.error, 'error')
                          }}
                          className="rounded-lg border border-rule px-2 py-1 text-xs font-medium text-stone-500 hover:border-red-300 hover:text-red-700"
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export function CasualLabourClient({
  modes,
  sections,
  rows,
}: {
  modes: string[]
  sections: Section[]
  rows: CasualLabourRow[]
}) {
  const router = useRouter()
  const nonCash = modes.filter((m) => m.toLowerCase() !== 'cash')
  const [f, setF] = useState({
    date: todayLocal(),
    sectionId: '',
    persons: '1',
    description: '',
    amount: '',
    paidVia: '',
    note: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))

  const canSave = !busy && f.paidVia !== '' && parseMoney(f.amount.trim()) !== null && Number(f.persons) > 0

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await saveCasualLabour(f)
      if (res.ok) {
        toast(`${formatMoneyString(res.entry.amount)} recorded`)
        setF((s) => ({ ...s, description: '', amount: '', note: '' }))
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Record casual labour</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          Daily hands who are not on the roster — a department may be named so the cost lands where the work
          happened, or left blank when it was for the whole place.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={fieldLabelCls}>Date worked</span>
            <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} className={`${numCls} w-full`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>People</span>
            <input value={f.persons} onChange={(e) => set('persons', e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={`${numCls} w-full text-right font-mono tabular-nums`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Amount (₹)</span>
            <input value={f.amount} onChange={(e) => set('amount', clean(e.target.value))} inputMode="decimal" placeholder="0.00" className={`${numCls} w-full text-right font-mono tabular-nums`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Department</span>
            <select value={f.sectionId} onChange={(e) => set('sectionId', e.target.value)} className={selectCls}>
              <option value="">— the whole place —</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Paid via</span>
            <select value={f.paidVia} onChange={(e) => set('paidVia', e.target.value)} className={selectCls}>
              <option value="">—</option>
              {nonCash.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>What they did</span>
            <input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="unloading, dishwashing…" className={inputCls} maxLength={200} />
          </label>
          <label className="block sm:col-span-3">
            <span className={fieldLabelCls}>Note</span>
            <input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
          </label>
        </div>
        <DrawerNote />
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
        >
          {busy ? 'Saving…' : 'Record casual labour'}
        </button>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Recent casual labour</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nothing yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Department</th>
                  <th className={thNumCls}>People</th>
                  <th className={thCls}>Work</th>
                  <th className={thNumCls}>Amount</th>
                  <th className={thCls}>
                    <span className="sr-only">Void</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`${trCls} ${r.is_reversal ? 'opacity-60' : ''}`}>
                    <td className={tdCls}>{fmtDate(r.work_date)}</td>
                    <td className={`${tdCls} text-stone-600`}>{r.section_name ?? 'whole place'}</td>
                    <td className={tdNumCls}>{r.persons}</td>
                    <td className={`${tdCls} text-stone-500`}>
                      {r.description ?? '—'}
                      {r.is_voided && (
                        <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                          voided
                        </span>
                      )}
                    </td>
                    <td className={`${tdNumCls} font-semibold`}>{formatMoneyString(r.amount)}</td>
                    <td className={`${tdCls} text-right`}>
                      {!r.is_reversal && !r.is_voided && (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await voidCasualLabour(r.id)
                            if (res.ok) {
                              toast('Entry voided')
                              router.refresh()
                            } else toast(res.error, 'error')
                          }}
                          className="rounded-lg border border-rule px-2 py-1 text-xs font-medium text-stone-500 hover:border-red-300 hover:text-red-700"
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
