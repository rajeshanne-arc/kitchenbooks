'use client'

// ASKING TO FORGIVE WHAT SOMEBODY OWES.
//
// It is the second of the two ways out of the refusal that stops a person
// being retired while they owe money, and it is the expensive one: recovering
// the balance in a final payroll run costs nothing, and writing it off costs
// the business the whole of it and moves the P&L.
//
// SO THE OWNER DECIDES AND THE REASON IS REQUIRED. Afterwards there is a
// reversal and an expense to read, and neither of them says WHY — the sentence
// typed here is the only account of that, and it is what the owner decides on.
//
// IT DOES NOT FORGIVE ANYTHING ITSELF. Until the owner approves it they still
// owe the money and still cannot be retired, and the acknowledgement says so
// rather than letting "asked" read as "done".

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import SaveAck from '@/components/SaveAck'
import Honesty from '@/components/Honesty'
import { requestWriteOff } from '@/server/approvals-actions'
import { formatMoneyString } from '@/lib/money'
import { exposureText } from '@/lib/advances'
import { fieldLabelCls, inputCls } from '@/components/ui'

export default function WriteOffRequest({
  staffId,
  staffName,
  outstanding,
  monthsOfSalary,
  canRequest,
}: {
  staffId: string
  staffName: string
  outstanding: string
  monthsOfSalary: string | null
  canRequest: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  if (!canRequest || Number(outstanding) <= 0) return null

  async function send() {
    setBusy(true)
    setError(null)
    const r = await requestWriteOff({ staffId, reason: reason.trim() })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setDone(r.message)
    setReason('')
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="mt-3">
      {done !== null && (
        <SaveAck onDismiss={() => setDone(null)} headline={done}>
          <p className="text-[13px] text-stone-600">
            Nothing has been forgiven and nothing has moved. It is with the owner.
          </p>
        </SaveAck>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-[40px] rounded-lg border border-rule px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
        >
          Ask to write it off
        </button>
      ) : (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-amber-900">
            Write off {formatMoneyString(outstanding)} for {staffName}
          </h4>
          {/* WHAT IT COSTS, BEFORE THE BUTTON. This is the one approval in the
              advance flow that moves the P&L, and the person raising it is not
              the person who pays for it. */}
          <p className="mt-1 text-[13px] text-amber-900">
            The business loses {formatMoneyString(outstanding)}
            {exposureText(monthsOfSalary) === null ? '' : ` — ${exposureText(monthsOfSalary)}`}. The
            money stays on the record as given: it becomes an expense rather than disappearing, so
            the P&amp;L carries the loss in the month it is forgiven.
          </p>
          <p className="mt-1 text-[13px] text-amber-900">
            The cheaper way out is recovering it in a final payroll run. That costs nothing.
          </p>

          <label className="mt-3 block">
            <span className={fieldLabelCls}>Why</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="left without notice, no forwarding address"
              className={inputCls}
            />
          </label>
          <p className="mt-1 text-xs text-amber-900">
            Required. A reversal and an expense are all that is left afterwards, and neither says
            why.
          </p>

          {error !== null && (
            <div className="mt-3">
              <Honesty verdict="Nothing was asked" level="alarm">
                {error}
              </Honesty>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={send}
              disabled={busy || reason.trim() === ''}
              className="min-h-[40px] rounded-lg border border-red-700 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {busy ? 'Asking…' : 'Ask the owner'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="min-h-[40px] rounded-lg border border-rule px-3 py-2 text-sm text-stone-600 hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
