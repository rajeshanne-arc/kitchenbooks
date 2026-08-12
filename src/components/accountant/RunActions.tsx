'use client'

// What can be done to a run, and by whom.
//
//   draft     → an OWNER approves it, or anyone here cancels it
//   approved  → it is marked paid, or cancelled
//   paid      → nothing: the money has gone
//   cancelled → nothing: it stays on the record
//
// The Approve button is rendered only for an owner (LAW 1 — a role never sees
// a control it cannot use) and the server refuses everyone else by name
// anyway, because a server action is a public endpoint and the button is not
// the check. An accountant who also owns the place signs in as the owner, and
// the record then says an owner approved it.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MoneyAccount, PayrollStatus } from '@/lib/types'
import {
  approvePayrollRun,
  cancelPayrollRun,
  markPayrollPaid,
} from '@/server/payroll-actions'
import AccountPicker from '@/components/accounts/AccountPicker'
import { toast } from '@/components/Toasts'
import {
  btnCls,
  cardCls,
  fieldLabelCls,
  inputCls,
  selectCls,
  sectionHeadCls,
} from '@/components/ui'

export default function RunActions({
  runId,
  status,
  accounts,
  modes,
  today,
  canApprove,
}: {
  runId: string
  status: PayrollStatus
  accounts: MoneyAccount[]
  modes: string[]
  today: string
  canApprove: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [paidOn, setPaidOn] = useState(today)
  const [accountId, setAccountId] = useState('')
  const [payMode, setPayMode] = useState('')

  async function run(what: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    if (busy) return
    setBusy(true)
    try {
      const res = await what()
      if (!res.ok) {
        toast(res.error ?? 'That did not go through', 'error')
        return
      }
      toast(done, 'ok')
      setConfirming(false)
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing changed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'paid') {
    return (
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Paid</h2>
        <p className="mt-1.5 text-sm text-stone-700">
          The money has gone. A paid run cannot be cancelled and its figures were never editable —
          the record stands as it is. If something in it is wrong, the correction is a separate
          entry that says so, not a change to this one.
        </p>
      </section>
    )
  }

  if (status === 'cancelled') {
    return (
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Cancelled</h2>
        <p className="mt-1.5 text-sm text-stone-700">
          This run was cancelled and stays on the record — a run that was prepared and abandoned is
          itself a thing that happened. Prepare another for the same period whenever the figures are
          right.
        </p>
      </section>
    )
  }

  const cancel = (
    <div className="mt-4 border-t border-rule-soft pt-3">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => cancelPayrollRun(runId), 'Run cancelled')}
            className="rounded-xl border border-red-300 bg-cell px-4 py-2.5 text-[15px] font-medium text-red-700 transition-colors hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-stone-400"
          >
            {busy ? 'Cancelling…' : 'Yes, cancel this run'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-sm font-medium text-stone-500 hover:text-stone-800"
          >
            keep it
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-sm font-medium text-stone-500 underline underline-offset-2 hover:text-red-700"
          >
            Cancel this run
          </button>
          <p className="mt-1 text-xs text-stone-500">
            Cancelling is how a wrong run is fixed: it stays on the record, and the right figures go
            on a new one. {status === 'approved' && 'An approved run loses its approval with it.'}
          </p>
        </>
      )}
    </div>
  )

  if (status === 'draft') {
    return (
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Waiting for approval</h2>
        {canApprove ? (
          <>
            <p className="mt-1.5 text-sm text-stone-700">
              Approving says these figures may be paid. It moves no money and files nothing — it
              records that you, as the owner, signed them off, and it is what lets the run be marked
              paid afterwards.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => approvePayrollRun(runId), 'Run approved')}
              className={`${btnCls} mt-3`}
            >
              {busy ? 'Approving…' : 'Approve this run'}
            </button>
          </>
        ) : (
          <p className="mt-1.5 text-sm text-stone-700">
            An OWNER approves a payroll run — the person who works the figures out is not the person
            who authorises them, and that split is the only control a small business has here. These
            figures are prepared and waiting: ask an owner to open this page and approve them.
          </p>
        )}
        {cancel}
      </section>
    )
  }

  const canPay = !busy && paidOn !== '' && accountId !== ''

  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Approved — record the payment</h2>
      <p className="mt-1.5 text-sm text-stone-700">
        This records that the wages went out: the date, the account they came from and how they were
        paid, onto every line at once. It does not move money.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelCls}>Paid on</span>
          <input
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>How it was paid</span>
          <select
            value={payMode}
            onChange={(e) => setPayMode(e.target.value)}
            className={selectCls}
            disabled={modes.length === 0}
          >
            <option value="">—</option>
            {modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-stone-500">
            {modes.length === 0
              ? 'No payment modes are on the list yet (Settings → Lists). The run can still be marked paid; it will simply not say how.'
              : 'One mode for the whole run — it lands on every line.'}
          </span>
        </label>
      </div>

      <div className="mt-3">
        <AccountPicker
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          label="Paid from"
          hint="the account the wages left"
        />
      </div>

      <button
        type="button"
        disabled={!canPay}
        onClick={() =>
          void run(
            () => markPayrollPaid({ runId, paidOn, accountId, payMode }),
            'Recorded as paid',
          )
        }
        className={`${btnCls} mt-3`}
      >
        {busy ? 'Recording…' : 'Mark this run paid'}
      </button>

      {cancel}
    </section>
  )
}
