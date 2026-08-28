'use client'

// Timezone and the business day start — the two settings that change what a
// DATE MEANS rather than how anything looks.
//
// TWO WARNINGS ON SCREEN, both before the save rather than after, because
// neither is recoverable by looking at the result:
//
//   1. THE CUTOVER MUST MATCH PETPOOJA'S. Ours decides which day an issue, a
//      close or a voucher is filed under; theirs decides which day an ORDER is
//      filed under, because pos_orders.business_date arrives already stamped by
//      them. If ours cuts at 05:00 and theirs at 04:00, every order in that
//      hour sits on a different day in the two systems — and day_close_ladder
//      joins those two definitions directly, so the drawer fails to reconcile
//      on exactly the late nights where it matters most.
//   2. CHANGING EITHER MOVES NO STORED DATE, but it changes what
//      business_date() returns from now on and what business_day_disagreements
//      computes for orders already stored. The books do not rewrite themselves;
//      their interpretation shifts.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { saveBusinessDay } from '@/server/business-day-actions'
import { toast } from '@/components/Toasts'
import Honesty from '@/components/Honesty'
import { btnCls, cardCls, fieldLabelCls, inputCls, sectionHeadCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'
import { tabHref } from '@/lib/routes'

/** A SHORT list of common zones as suggestions, not 400 rendered options. The
 *  field still accepts any IANA name — Postgres' own catalogue is the check,
 *  so a restaurant somewhere nobody thought of is not locked out by this list. */
const COMMON = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Colombo',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Europe/London',
  'Europe/Dublin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
  'UTC',
]

export default function BusinessDayEditor({
  timezone,
  businessDayStart,
  canSeeDisagreements,
}: {
  timezone: string
  businessDayStart: string
  /** whether this reader may open business_day_disagreements — the link is a
   *  PROP, never a literal, because a role that cannot open it must not be
   *  shown it (LAW 1, in the smallest possible way) */
  canSeeDisagreements: boolean
}) {
  const router = useRouter()
  const [tz, setTz] = useState(timezone)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)
  const [start, setStart] = useState(businessDayStart)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = tz !== timezone || start !== businessDayStart

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await saveBusinessDay(tz, start)
      if (res.ok) {
        setAck({ headline: `The day now runs from ${start} in ${tz}`, sub: 'No stored date moved. What changed is how every date is read from now on — and what the disagreement report computes for orders already stored.' })
        toast('Saved — dates are read against the new day from now on')
        setConfirming(false)
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={cardCls}>
      {ack !== null && (
        <div className="mb-3">
          <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>The day, and where you are</h2>
        <span className="font-mono text-[11px] text-stone-400">settings</span>
      </div>
      <p className="mt-1 text-sm text-stone-600">
        A restaurant&apos;s day does not end at midnight. These two settings decide which day an order at
        00:30 belongs to — and everything counted per day is counted against them.
      </p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabelCls}>Timezone</span>
          <input
            list="kb-timezones"
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder="Asia/Kolkata"
            className={inputCls}
          />
          <datalist id="kb-timezones">
            {COMMON.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <span className="mt-1 block text-xs text-stone-500">
            Any IANA name. The list is the common ones, not the limit.
          </span>
        </label>
        <label className="block">
          <span className={fieldLabelCls}>The business day starts at</span>
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-stone-500">
            00:00 means the day ends at midnight, which is right for a place that closes before it.
          </span>
        </label>
      </div>

      {/* WARNING ONE — the one that costs money. */}
      <div className="mt-3">
        <Honesty level="alarm" verdict="must match Petpooja">
          This cutover has to be the same as the one configured in Petpooja. Orders arrive already stamped
          with THEIR business date; everything else here is stamped with ours. If the two disagree, every
          order in the gap hour is filed on a different day in the two systems, and the drawer will not
          reconcile on exactly the late nights when it matters.
          {canSeeDisagreements && (
            <>
              {' '}
              <Link href={tabHref('owner', 'dashboard')} className="underline underline-offset-2">
                The dashboard reports disagreements
              </Link>{' '}
              once a day with order times has been fetched — until then an empty result means nothing has
              been compared, not that the two agree.
            </>
          )}
        </Honesty>
      </div>

      {error !== null && (
        <p role="alert" className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* WARNING TWO — said BEFORE the save, in the confirm step, because
          afterwards there is nothing on screen that would look different. */}
      {confirming ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-field p-3">
          <p className="text-sm text-stone-800">
            Changing this does not move a single stored date. What it changes is{' '}
            <b>how every date is read from now on</b> — which day a 00:30 order, issue or close is filed
            under — and what the disagreement report computes for orders already stored.
          </p>
          <p className="mt-1.5 text-sm text-stone-700">
            {timezone} → <b>{tz}</b>, day starting {businessDayStart} → <b>{start}</b>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={busy} className={btnCls}>
              {busy ? 'Saving…' : 'Yes, change what a day means'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="min-h-[44px] rounded-xl px-4 text-sm font-medium text-stone-600 hover:bg-stone-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!changed}
          className={`mt-3 ${btnCls} disabled:cursor-not-allowed disabled:bg-stone-300`}
        >
          {changed ? 'Review the change' : 'No change to save'}
        </button>
      )}
    </section>
  )
}
