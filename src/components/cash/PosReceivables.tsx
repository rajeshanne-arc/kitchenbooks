'use client'

// MONEY THE POS SAYS WE ARE OWED AND OUR BOOKS DO NOT.
//
// Petpooja bills an order as Due Payment (nothing collected) or Part Payment
// (not all of it collected). Both are receivables it already knows about, and
// `due_payments` is manual-entry only, so neither has ever reached the dues
// page.
//
// A QUEUE, NOT AN AUTOMATIC WRITE. The POS carries the amount and the order;
// it does not carry WHO owes it, and `dues_outstanding` nets on the party
// name — so an automatic row would have to invent one, and every invented
// name is a permanent second entity in a ledger that nets on names.
//
// DUE PAYMENT asks WHO. The whole bill is owed, so the amount is the POS's
// own figure, prefilled and editable — not a guess.
// PART PAYMENT asks WHO AND HOW MUCH, because the POS gives the order total
// and not the split. The total is shown for reference and never written.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PosReceivableRow } from '@/lib/types'
import { confirmPosReceivable } from '@/server/cashier-actions'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty from '@/components/Honesty'
import { toast } from '@/components/Toasts'
import { cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'

type Draft = { party: string; amount: string; note: string }

export default function PosReceivables({
  rows,
  parties,
}: {
  rows: PosReceivableRow[]
  /** prior party names — LAW 2's person rule: picker from history, plus
   *  add-new. Free text alone is how "Asheel" and "Asheel Sir" become two
   *  people in a ledger that nets on names. */
  parties: string[]
}) {
  const router = useRouter()
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  if (rows.length === 0) return null

  const key = (r: PosReceivableRow) => `${r.business_date}:${r.pos_order_id}`
  const draftFor = (r: PosReceivableRow): Draft =>
    drafts[key(r)] ?? {
      party: '',
      // The whole bill is owed on a Due Payment, so the POS's own figure IS
      // the amount. A Part Payment starts blank: we do not know the split.
      amount: r.payment_mode === 'Due Payment' ? r.order_total : '',
      note: '',
    }
  const total = rows.reduce((n, r) => n + Number(r.order_total), 0)

  async function confirm(r: PosReceivableRow) {
    const d = draftFor(r)
    if (d.party.trim() === '' || d.amount.trim() === '') return
    setBusy(key(r))
    try {
      const res = await confirmPosReceivable({
        businessDate: r.business_date,
        posOrderId: r.pos_order_id,
        party: d.party.trim(),
        amount: d.amount.trim(),
        note: d.note.trim(),
      })
      if (res.ok) {
        const owed =
          res.outstanding.find((o) => o.party.toLowerCase().trim() === d.party.toLowerCase().trim())?.balance ?? '0'
        toast(`${res.due.party} owes ${formatMoneyString(owed)} — order ${r.pos_order_id} is off the queue`)
        router.refresh()
      } else {
        toast(res.error, 'error')
      }
    } catch {
      toast('Could not reach the server — nothing was recorded.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={`${cardCls} border-amber-300 bg-amber-50/40`}>
      {ack !== null && (
        <div className="mb-3">
          <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>The POS says we are owed money</h2>
        <span className="font-mono text-[11px] text-stone-400">sales_current</span>
      </div>
      <div className="mt-2">
        <Honesty verdict="not in the books" meter={{ filled: 0, total: rows.length, unit: 'confirmed' }}>
          {rows.length} {rows.length === 1 ? 'order was' : 'orders were'} billed and not collected —{' '}
          {formatMoneyString(total.toFixed(2))} the POS already knows about and the dues page does not. Nothing is
          written until somebody says who owes it: the POS knows the amount, never the person, and a name invented here
          would sit in the ledger for ever.
        </Honesty>
      </div>

      <ul className="mt-3 space-y-3">
        {rows.map((r) => {
          const d = draftFor(r)
          const part = r.payment_mode === 'Part Payment'
          return (
            <li key={key(r)} className="rounded-xl border border-rule bg-cell p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[15px] font-medium text-stone-900">
                  {fmtDate(r.business_date)} · order {r.pos_order_id}
                </span>
                <span className="font-mono text-sm tabular-nums text-stone-900">
                  {formatMoneyString(r.order_total)}
                  <span className="ml-1.5 text-[11px] font-normal text-amber-800">{r.payment_mode}</span>
                </span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_9rem]">
                <label className="block">
                  <span className={fieldLabelCls}>Who owes it</span>
                  <input
                    list="kb-pos-due-parties"
                    value={d.party}
                    onChange={(e) => setDrafts((p) => ({ ...p, [key(r)]: { ...d, party: e.target.value } }))}
                    placeholder="pick or add"
                    maxLength={120}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabelCls}>{part ? 'How much is owed' : 'Amount'}</span>
                  <input
                    inputMode="decimal"
                    value={d.amount}
                    onChange={(e) =>
                      setDrafts((p) => ({
                        ...p,
                        [key(r)]: { ...d, amount: e.target.value.replace(/[^\d.]/g, '') },
                      }))
                    }
                    placeholder={part ? 'part of the bill' : '0.00'}
                    className={`${numCls} w-full text-right`}
                  />
                </label>
              </div>
              {part && (
                <p className="mt-1 text-[11px] text-stone-500">
                  The POS gives the order total, not the split — {formatMoneyString(r.order_total)} was billed and
                  some of it was collected. Only the unpaid remainder belongs in dues.
                </p>
              )}
              <button
                type="button"
                onClick={() => void confirm(r)}
                disabled={busy === key(r) || d.party.trim() === '' || d.amount.trim() === ''}
                className="mt-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                {busy === key(r) ? 'Recording…' : 'Confirm the debt'}
              </button>
            </li>
          )
        })}
      </ul>
      <datalist id="kb-pos-due-parties">
        {parties.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </section>
  )
}
