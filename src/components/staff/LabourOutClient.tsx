'use client'

// Contract bills and casual labour — the two kinds of labour that are not
// on the roster. Both feed the P&L's labour line, which counted only
// salaried staff until these existed, and so understated what labour costs.
//
// THE DRAWER RULE, and it is checkable rather than a habit:
// day_close_ladder reads cash_vouchers and does NOT read either of these
// tables. Money paid out of the till and recorded only here would leave the
// drawer short at close with nothing to explain it.
//
// So till cash is refused here — but it is no longer a dead end. A drawer-
// paid day hand is ONE payment, so it is ONE record: a cash voucher with
// is_casual_labour ticked, which the drawer sees and which pnl_monthly's
// casual_labour line UNIONs in. Asking for both a voucher and a row here
// would be double entry with nothing checking the halves.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  CasualLabourRow,
  ContractBillRow,
  MoneyAccount,
  SaveCasualLaboursResult,
  Section,
} from '@/lib/types'
import {
  saveCasualLabours,
  saveContractBill,
  voidCasualLabour,
  voidContractBill,
} from '@/server/expenses-actions'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
import {
  cardCls,
  dataTableCls,
  docNoCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  selectCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import SaveAck from '@/components/SaveAck'
import { toast } from '@/components/Toasts'
import { useBusinessToday } from '@/components/BusinessDay'

const clean = (s: string) => s.replace(/[^\d.]/g, '')

function DrawerNote() {
  return (
    <p className="mt-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
      Paid from the drawer? Record it as a Cash Voucher on the Cash page and answer{' '}
      <span className="font-medium">&ldquo;was this a day hand&apos;s wages?&rdquo;</span> — that puts it on the
      drawer AND on the labour line from one entry. This form is for labour paid any other way.
    </p>
  )
}

export function ContractBillsClient({
  accounts,
  modes,
  rows,
}: {
  accounts: MoneyAccount[]
  modes: string[]
  rows: ContractBillRow[]
}) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const nonCash = modes.filter((m) => m.toLowerCase() !== 'cash')
  const [savedBill, setSavedBill] = useState<ContractBillRow | null>(null)
  const [f, setF] = useState({
    date: businessToday,
    vendorName: '',
    service: '',
    headcount: '',
    periodStart: '',
    periodEnd: '',
    amount: '',
    paidVia: '',
    note: '',
  })
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))

  const canSave =
    !busy &&
    f.vendorName.trim() !== '' &&
    f.paidVia !== '' &&
    accountId !== '' &&
    parseMoney(f.amount.trim()) !== null

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await saveContractBill({ ...f, accountId })
      if (res.ok) {
        setSavedBill(res.bill)
        setF((s) => ({ ...s, vendorName: '', service: '', headcount: '', amount: '', note: '' }))
        setAccountId('')
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
      {savedBill !== null && (
        <SaveAck
          onDismiss={() => setSavedBill(null)}
          headline={
            <>
              {savedBill.vendor_name} — <span className="tabular-nums">{formatMoneyString(savedBill.amount)}</span>
            </>
          }
          sub={
            <>
              {fmtDate(savedBill.bill_date)}
              {savedBill.doc_no !== null && (
                <>
                  {' · '}
                  <span className={docNoCls}>{savedBill.doc_no}</span>
                </>
              )}{' '}
              · it lands on the P&amp;L&apos;s LABOUR line, not expenses — people you pay who are not on payroll
            </>
          }
        />
      )}
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
          {/* “paid via” is the method; this is the account it left from. Till
              cash is already withheld above — drawer-paid labour is a voucher. */}
          <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} label="Paid from" />
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
                  <th className={thCls}>Doc</th>
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
                    <td className={tdCodeCls}>{r.doc_no ?? '—'}</td>
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

type CasualLine = {
  key: number
  accountId: string
  sectionId: string
  persons: string
  description: string
  amount: string
  paidVia: string
  note: string
}
const newCasualLine = (key: number): CasualLine => ({
  key,
  accountId: '',
  sectionId: '',
  persons: '1',
  description: '',
  amount: '',
  paidVia: '',
  note: '',
})

export function CasualLabourClient({
  accounts,
  modes,
  sections,
  rows,
}: {
  accounts: MoneyAccount[]
  modes: string[]
  sections: Section[]
  rows: CasualLabourRow[]
}) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const nonCash = modes.filter((m) => m.toLowerCase() !== 'cash')
  const [date, setDate] = useState(businessToday)
  const [lines, setLines] = useState<CasualLine[]>([newCasualLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<Extract<SaveCasualLaboursResult, { ok: true }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const patch = (key: number, p: Partial<CasualLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newCasualLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) =>
    setLines((ls) => (ls.length === 1 ? [newCasualLine(nextKey)] : ls.filter((l) => l.key !== key)))

  const lineOk = (l: CasualLine) =>
    l.paidVia !== '' && l.accountId !== '' && parseMoney(l.amount.trim()) !== null && Number(l.persons) > 0
  const canSave = !busy && lines.every(lineOk)
  const runningTotal = lines.reduce((n, l) => n + (Number(l.amount.trim()) || 0), 0).toFixed(2)

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await saveCasualLabours({
        date,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          sectionId: l.sectionId,
          persons: l.persons,
          description: l.description,
          amount: l.amount,
          paidVia: l.paidVia,
          note: l.note,
        })),
      })
      if (res.ok) {
        setSaved(res)
        setLines([newCasualLine(nextKey)])
        setNextKey((k) => k + 1)
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
      {saved !== null && (
        <SaveAck
          onDismiss={() => setSaved(null)}
          headline={
            <>
              {saved.rows.length === 1 ? '1 day hand' : `${saved.rows.length} day hands`} paid —{' '}
              <span className="tabular-nums">{formatMoneyString(saved.total)}</span>
            </>
          }
          sub="on the P&amp;L's LABOUR line · never from till cash — that is one Cash Voucher ticked “a day hand”, so the drawer reconciles against ONE record of ONE payment"
          missing={
            saved.rows.filter((r) => r.section_name === null).length > 0
              ? [
                  {
                    verdict: 'no department',
                    text: `${
                      saved.rows.filter((r) => r.section_name === null).length
                    } of these name no department, so the cost lands against the whole place rather than where the work happened. That is a real answer for a day's unloading — it is only a gap if somebody knew.`,
                  },
                ]
              : undefined
          }
        />
      )}
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Record casual labour</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          Daily hands who are not on the roster — a department may be named so the cost lands where the work
          happened, or left blank when it was for the whole place.
        </p>
        <label className="mt-3 block sm:w-44">
          <span className={fieldLabelCls}>Date worked</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
        </label>

        {/* A CARD PER PAYMENT. The DEPARTMENT is per line, argued: a day's
            hands routinely split across departments — one unloading for the
            store, one washing up in the kitchen — and blank still means the
            whole place, which is a real answer rather than a missing one. */}
        <div className="mt-3 space-y-3">
          {lines.map((l, idx) => (
            <div key={l.key} className="rounded-xl border border-rule bg-cell p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  Payment {idx + 1}
                </span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    className="text-sm text-stone-400 hover:text-red-700"
                    aria-label={`Remove payment ${idx + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={fieldLabelCls}>People</span>
                  <input
                    value={l.persons}
                    onChange={(e) => patch(l.key, { persons: e.target.value.replace(/\D/g, '') })}
                    inputMode="numeric"
                    className={`${numCls} w-full text-right font-mono tabular-nums`}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabelCls}>Amount (₹)</span>
                  <input
                    value={l.amount}
                    onChange={(e) => patch(l.key, { amount: clean(e.target.value) })}
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`${numCls} w-full text-right font-mono tabular-nums`}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabelCls}>Department</span>
                  <select
                    value={l.sectionId}
                    onChange={(e) => patch(l.key, { sectionId: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">— the whole place —</option>
                    {sections.map((sec) => (
                      <option key={sec.id} value={sec.id}>
                        {sec.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={fieldLabelCls}>Paid via</span>
                  <select
                    value={l.paidVia}
                    onChange={(e) => patch(l.key, { paidVia: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">—</option>
                    {nonCash.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sm:col-span-2">
                  {/* the mode is how, this is from where */}
                  <AccountPicker
                    accounts={accounts}
                    value={l.accountId}
                    onChange={(id) => patch(l.key, { accountId: id })}
                    label="Paid from"
                  />
                </div>
                <label className="block sm:col-span-2">
                  <span className={fieldLabelCls}>What they did</span>
                  <input
                    value={l.description}
                    onChange={(e) => patch(l.key, { description: e.target.value })}
                    placeholder="unloading, dishwashing…"
                    className={inputCls}
                    maxLength={200}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className={fieldLabelCls}>Note</span>
                  <input
                    value={l.note}
                    onChange={(e) => patch(l.key, { note: e.target.value })}
                    placeholder="optional"
                    className={inputCls}
                    maxLength={300}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addLine}
          className="mt-3 rounded-full border border-rule bg-cell px-3.5 py-2 text-sm font-medium text-stone-700 hover:border-stone-400"
        >
          ＋ Add another payment
        </button>

        {lines.length > 1 && (
          <p className="mt-3 text-sm text-stone-600">
            {lines.length} payments ·{' '}
            <span className="font-semibold tabular-nums text-stone-900">{formatMoneyString(runningTotal)}</span>{' '}
            <span className="text-stone-400">— each gets its own CAS number</span>
          </p>
        )}

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
          {busy ? 'Saving…' : lines.length === 1 ? 'Record casual labour' : `Record ${lines.length} payments`}
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
                  <th className={thCls}>Doc</th>
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
                    <td className={tdCodeCls}>{r.doc_no ?? '—'}</td>
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
