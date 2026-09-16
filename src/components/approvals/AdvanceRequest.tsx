'use client'

// ASKING FOR AN ADVANCE — money out against bills that do not exist yet.
//
// IT IS NOT A PAYMENT AND THE FORM SHOWS WHY. A payment names a RANGE of bills
// and is measured against what they come to, at raise and again under the lock
// at pay. There is nothing here to measure against: no range, no drift guard,
// nothing but somebody's judgement and the reason they type. That is the whole
// argument for it being a separate KIND — the advance tick on the payment form
// made one form mean two things, was never persisted, and could not survive
// its own pay-time check, so an approved advance could never be paid.
//
// WHOEVER ASKS CANNOT PAY. The store manager can raise this and settle none of
// it: he has no account to pay from, which is why the request exists at all.
// It goes to the owner, who can see the cash position.
//
// NO RATE, EVER. A loan here is an advance with an instalment. Interest is not
// charged and there is no field for one — the withholding rule again: this app
// records what was agreed and does not price money.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import SaveAck from '@/components/SaveAck'
import Honesty from '@/components/Honesty'
import { requestAdvance } from '@/server/approvals-actions'
import { parseMoney, formatPaise } from '@/lib/money'
import { fieldLabelCls, inputCls, btnCls } from '@/components/ui'

export default function AdvanceRequest({
  subject,
  subjectId,
  subjectName,
  canRequest,
  /** what they already owe, where the caller knows it — the context for
   *  lending more, which is the whole reason it is on the person's own page
   *  rather than only on a central list nobody opens first. */
  alreadyOwes = null,
}: {
  subject: 'vendor' | 'staff'
  subjectId: string
  subjectName: string
  canRequest: boolean
  alreadyOwes?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [instalment, setInstalment] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // WHO MAY ASK IS THE MATRIX'S ANSWER, not this component's. An accountant
  // reads a staff profile and is not a requester; showing them a control they
  // cannot use is LAW 1 broken in the smallest possible way.
  if (!canRequest) return null

  const paise = parseMoney(amount.trim())
  const instPaise = instalment.trim() === '' ? null : parseMoney(instalment.trim())
  const months = paise !== null && instPaise !== null && instPaise > 0 ? Math.ceil(paise / instPaise) : null
  const instTooBig = paise !== null && instPaise !== null && instPaise > paise
  const canSave =
    !busy && paise !== null && paise > 0 && reason.trim() !== '' && !instTooBig &&
    (instalment.trim() === '' || (instPaise !== null && instPaise > 0))

  async function send() {
    setBusy(true)
    setError(null)
    const r = await requestAdvance({
      subject,
      subjectId,
      amount: amount.trim(),
      reason: reason.trim(),
      instalment: instalment.trim() === '' ? undefined : instalment.trim(),
    })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setDone(r.message)
    setAmount('')
    setInstalment('')
    setReason('')
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="mt-3">
      {done !== null && (
        <SaveAck onDismiss={() => setDone(null)} headline={done}>
          {/* THE SECOND LINE IS THE POINT. A request moves no money, and
              reading it as handled is how somebody promises twice. */}
          <p className="text-[13px] text-stone-600">
            Nothing has been paid and no account has been touched. It is with the owner until he
            decides, and the money moves only when somebody hands it over and records it.
          </p>
        </SaveAck>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-[40px] rounded-lg border border-rule px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
        >
          Ask for an advance
        </button>
      ) : (
        <div className="rounded-xl border border-rule bg-field p-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-stone-500">
            An advance for {subjectName}
          </h4>
          <p className="mt-1 text-[13px] text-stone-600">
            Money out against nothing yet — no bills, so there is nothing to check it against but
            your reason. The owner decides it, because he is the one who can see the cash.
          </p>

          {alreadyOwes !== null && Number(alreadyOwes) > 0 && (
            <div className="mt-2">
              <Honesty verdict="already owing" compact>
                {subjectName} has not paid back {formatPaise(Math.round(Number(alreadyOwes) * 100))} yet.
                That is not a refusal — it is the thing to know before asking for more.
              </Honesty>
            </div>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={fieldLabelCls}>How much</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Taken back each month</span>
              <input
                inputMode="decimal"
                value={instalment}
                onChange={(e) => setInstalment(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="leave blank to take it all at once"
                className={inputCls}
              />
            </label>
          </div>

          {/* AN INSTALMENT IS WHAT MAKES IT A LOAN, and the schedule is worked
              out here so nobody agrees to a number of months nobody counted. */}
          {months !== null && !instTooBig && (
            <p className="mt-1.5 text-xs text-stone-600">
              {months} month{months === 1 ? '' : 's'} to clear it. No interest is charged — this app
              records what was agreed and does not price money.
            </p>
          )}
          {instTooBig && (
            <p className="mt-1.5 text-xs font-medium text-red-700">
              That instalment is more than the advance. Leave it blank for a one-off.
            </p>
          )}

          <label className="mt-3 block">
            <span className={fieldLabelCls}>Why</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={subject === 'staff' ? 'school fees, paying it back monthly' : 'they want half up front for the festival order'}
              className={inputCls}
            />
          </label>
          {/* REQUIRED, AND THE FORM SAYS SO BEFORE THE BUTTON. There is no
              range and no balance behind an advance — the sentence IS the
              record, and it is what the owner decides on. */}
          <p className="mt-1 text-xs text-stone-500">
            Required. There are no bills behind an advance, so this sentence is the whole of what
            the owner has to go on.
          </p>

          {error !== null && (
            <div className="mt-3">
              <Honesty verdict="Nothing was asked" level="alarm">
                {error}
              </Honesty>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={send} disabled={!canSave} className={btnCls}>
              {busy ? 'Asking…' : 'Ask the owner'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="min-h-[40px] rounded-lg border border-rule px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
