'use client'

// Catering. The event carries what was COLLECTED; its cost is never typed.
// Food cost is the sum of the issues STAMPED to this event, and other
// expenses are its own lines — catering_summary does the arithmetic.
//
// NO MENU PRICE ANYWHERE, deliberately. A catering job is costed from what
// actually left the store, not from what those dishes would have sold for
// on a normal evening. The two are different numbers and only one of them
// was really spent.
//
// THE TRAP THIS SCREEN GUARDS: food_cost counts ONLY stamped issues. An
// event with no stamped issue therefore reads margin = revenue, which looks
// like a wildly profitable job rather than an uncosted one. Where that is
// what the data says, the screen says it is not to be believed.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CateringSummaryRow } from '@/lib/types'
import { addCateringExpense, saveCateringEvent, updateCateringRevenue } from '@/server/catering-actions'
import { decimalStringToPaise, formatMoneyString, parseMoney } from '@/lib/money'
import { fmtDate } from '@/lib/format'
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
import Honesty from '@/components/Honesty'
import { toast } from '@/components/Toasts'
import { useBusinessToday } from '@/components/BusinessDay'

export default function CateringClient({
  events,
  modes,
}: {
  events: CateringSummaryRow[]
  modes: string[]
}) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const [f, setF] = useState({
    date: businessToday,
    name: '',
    customer: '',
    contact: '',
    covers: '',
    revenueCollected: '',
    paymentMode: '',
    note: '',
  })
  const [expenseFor, setExpenseFor] = useState<string | null>(null)
  // Revenue arrives AFTER the event — the cheque clears days later — so it
  // is the one figure editable in place. Cost never is: it is the issues.
  const [revFor, setRevFor] = useState<string | null>(null)
  const [rev, setRev] = useState({ amount: '', mode: '' })
  const [ex, setEx] = useState({ description: '', amount: '', paidVia: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))

  const canSave = !busy && f.name.trim() !== ''

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await saveCateringEvent(f)
      if (res.ok) {
        toast(`${res.event.name} created`)
        setF((s) => ({ ...s, name: '', customer: '', contact: '', covers: '', revenueCollected: '', note: '' }))
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  async function saveExpense(id: string) {
    if (parseMoney(ex.amount.trim()) === null) return
    setBusy(true)
    try {
      const res = await addCateringExpense({ cateringId: id, ...ex, amount: ex.amount.trim() })
      if (res.ok) {
        toast(`Expense added — ${formatMoneyString(ex.amount.trim())}`)
        setEx({ description: '', amount: '', paidVia: '' })
        setExpenseFor(null)
        router.refresh()
      } else toast(res.error, 'error')
    } finally {
      setBusy(false)
    }
  }

  const uncosted = events.filter((e) => decimalStringToPaise(e.food_cost) === 0)

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>New event</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          The cost is not typed here — it accumulates from the issues stamped to this event when the store
          sends stock out on a Catering session.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={fieldLabelCls}>Event date</span>
            <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} className={`${numCls} w-full`} />
          </label>
          <label className="block sm:col-span-2">
            <span className={fieldLabelCls}>Event name</span>
            <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Sharma wedding, office lunch…" className={inputCls} maxLength={120} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Customer</span>
            <input value={f.customer} onChange={(e) => set('customer', e.target.value)} className={inputCls} maxLength={120} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Contact</span>
            <input value={f.contact} onChange={(e) => set('contact', e.target.value)} inputMode="tel" className={inputCls} maxLength={60} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Covers</span>
            <input value={f.covers} onChange={(e) => set('covers', e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={`${numCls} w-full text-right font-mono tabular-nums`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Revenue collected (₹)</span>
            <input value={f.revenueCollected} onChange={(e) => set('revenueCollected', e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="0.00" className={`${numCls} w-full text-right font-mono tabular-nums`} />
            <span className="mt-1 block text-xs text-stone-500">can be filled in later</span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Paid via</span>
            <select value={f.paymentMode} onChange={(e) => set('paymentMode', e.target.value)} className={selectCls}>
              <option value="">—</option>
              {modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Note</span>
            <input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
          </label>
        </div>
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
          {busy ? 'Saving…' : 'Create event'}
        </button>
      </section>

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Events</h2>
          <span className="font-mono text-[10px] text-stone-400">catering_summary</span>
        </div>

        {events.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">No catering events yet.</p>
        ) : (
          <>
            {uncosted.length > 0 && (
              <div className="mt-2">
                <Honesty verdict="uncosted" compact>
                  {uncosted.length} {uncosted.length === 1 ? 'event has' : 'events have'} no stock stamped to{' '}
                  {uncosted.length === 1 ? 'it' : 'them'}, so {uncosted.length === 1 ? 'its' : 'their'} margin
                  reads as the whole revenue. That is an uncosted job, not a profitable one — the store stamps
                  an issue to an event by choosing the Catering session.
                </Honesty>
              </div>
            )}
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Event</th>
                    <th className={thCls}>Date</th>
                    <th className={thNumCls}>Covers</th>
                    <th className={thNumCls}>Revenue</th>
                    <th className={thNumCls}>Food cost</th>
                    <th className={thNumCls}>Other</th>
                    <th className={thNumCls}>Margin</th>
                    <th className={thCls}>
                      <span className="sr-only">Expense</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const food = decimalStringToPaise(e.food_cost)
                    const margin = decimalStringToPaise(e.margin)
                    return (
                      <tr key={e.catering_id} className={trCls}>
                        <td className={tdCls}>
                          <span className="font-medium">{e.name}</span>
                          {e.customer !== null && (
                            <span className="ml-1.5 text-[11px] text-stone-500">{e.customer}</span>
                          )}
                        </td>
                        <td className={`${tdCls} text-stone-600`}>{fmtDate(e.event_date)}</td>
                        <td className={`${tdNumCls} text-stone-500`}>{e.covers ?? '—'}</td>
                        <td className={tdNumCls}>
                          <button
                            type="button"
                            onClick={() => {
                              setRevFor(revFor === e.catering_id ? null : e.catering_id)
                              setRev({ amount: e.revenue_collected, mode: '' })
                            }}
                            className="underline decoration-dotted underline-offset-2 hover:text-emerald-700"
                            title="Revenue arrives after the event — edit it here"
                          >
                            {formatMoneyString(e.revenue_collected)}
                          </button>
                        </td>
                        <td className={`${tdNumCls} ${food === 0 ? 'text-amber-800' : ''}`}>
                          {food === 0 ? 'none stamped' : formatMoneyString(e.food_cost)}
                        </td>
                        <td className={tdNumCls}>{formatMoneyString(e.other_expenses)}</td>
                        <td
                          className={`${tdNumCls} font-semibold ${
                            food === 0 ? 'text-stone-400' : margin < 0 ? 'text-red-700' : 'text-stone-900'
                          }`}
                        >
                          {food === 0 ? 'not real' : formatMoneyString(e.margin)}
                        </td>
                        <td className={`${tdCls} text-right`}>
                          <button
                            type="button"
                            onClick={() => setExpenseFor(expenseFor === e.catering_id ? null : e.catering_id)}
                            className="rounded-lg border border-rule px-2 py-1 text-xs font-medium text-stone-600 hover:border-emerald-400 hover:text-emerald-700"
                          >
                            ＋ expense
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {revFor !== null && (
              <div className="mt-3 rounded-xl border border-rule bg-stone-50 p-3">
                <h3 className={sectionHeadCls}>Revenue collected</h3>
                <p className="mt-0.5 text-xs text-stone-500">
                  The cheque clears days after the food goes out, so this is the one figure that changes later.
                  The cost never does — it is the issues.
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <input
                    value={rev.amount}
                    onChange={(e) => setRev((v) => ({ ...v, amount: e.target.value.replace(/[^\d.]/g, '') }))}
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`${numCls} w-full text-right font-mono tabular-nums`}
                    aria-label="Revenue collected"
                  />
                  <select
                    value={rev.mode}
                    onChange={(e) => setRev((v) => ({ ...v, mode: e.target.value }))}
                    className={selectCls}
                    aria-label="Paid via"
                  >
                    <option value="">paid via…</option>
                    {modes.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={async () => {
                      setBusy(true)
                      try {
                        const res = await updateCateringRevenue(revFor, rev.amount.trim(), rev.mode)
                        if (res.ok) {
                          toast('Revenue updated')
                          setRevFor(null)
                          router.refresh()
                        } else toast(res.error, 'error')
                      } finally {
                        setBusy(false)
                      }
                    }}
                    disabled={busy}
                    className="rounded-xl bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
                  >
                    Save revenue
                  </button>
                </div>
              </div>
            )}

            {expenseFor !== null && (
              <div className="mt-3 rounded-xl border border-rule bg-stone-50 p-3">
                <h3 className={sectionHeadCls}>Add an expense to this event</h3>
                <p className="mt-0.5 text-xs text-stone-500">
                  Hire, transport, extra hands — anything spent on the job that is not stock from the store.
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <input
                    value={ex.description}
                    onChange={(e) => setEx((v) => ({ ...v, description: e.target.value }))}
                    placeholder="what it was"
                    className={inputCls}
                    maxLength={200}
                    aria-label="Expense description"
                  />
                  <input
                    value={ex.amount}
                    onChange={(e) => setEx((v) => ({ ...v, amount: e.target.value.replace(/[^\d.]/g, '') }))}
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`${numCls} w-full text-right font-mono tabular-nums`}
                    aria-label="Expense amount"
                  />
                  <select
                    value={ex.paidVia}
                    onChange={(e) => setEx((v) => ({ ...v, paidVia: e.target.value }))}
                    className={selectCls}
                    aria-label="Paid via"
                  >
                    <option value="">paid via…</option>
                    {modes.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => void saveExpense(expenseFor)}
                  disabled={busy || parseMoney(ex.amount.trim()) === null}
                  className="mt-3 w-full rounded-xl bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
                >
                  Add expense
                </button>
              </div>
            )}
          </>
        )}
        <p className="mt-3 text-xs text-stone-400">
          No menu price anywhere — a catering job is costed from what actually left the store, not from what
          those dishes would have sold for.
        </p>
      </section>
    </div>
  )
}
