'use client'

// The judgement, as a button that says what it will do before it does it.
//
// A count changes nothing on its own. This is where a person decides the
// shelf was right and the book was wrong — and because a bad count would
// corrupt the very number the count protects, the decision is separate,
// deliberate, and stamped with a name. There is no undo: the confirm step
// exists because of that, and it states the consequence in figures rather
// than asking "are you sure?".

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { acceptCount } from '@/server/adjustment-actions'
import { toast } from '@/components/Toasts'
import { formatMoneyString } from '@/lib/money'
import { btnCls, btnGhostCls, cardCls, sectionHeadCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'

export default function AcceptCount({
  countId,
  varianceLines,
  varianceValue,
}: {
  countId: string
  /** how many adjustments this will write — 0 is a real answer */
  varianceLines: number
  varianceValue: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onAccept() {
    setSaving(true)
    setError(null)
    try {
      const res = await acceptCount(countId)
      if (res.ok) {
        toast(
          res.adjustments === 0
            ? 'Accepted — the book was right, nothing was corrected'
            : `Accepted — ${res.adjustments} ${res.adjustments === 1 ? 'correction' : 'corrections'} written to the book`,
        )
        setConfirming(false)
        router.refresh()
      } else {
        setError(res.error)
        toast(res.error, 'error')
      }
    } catch {
      setError('Could not reach the server — nothing was accepted. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={cardCls}>
      {ack !== null && (
        <div className="mb-3">
          <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />
        </div>
      )}
      <h2 className={sectionHeadCls}>Accept into the book</h2>
      <p className="mt-2 text-sm text-stone-700">
        The count above changed nothing. A variance can be a counting error as easily as a stock error, so the book
        is corrected only when somebody decides the shelf was right — and that decision is recorded under their name.
      </p>
      <p className="mt-2 text-sm text-stone-700">
        {varianceLines === 0 ? (
          <>
            Nothing differs from the book. Accepting writes no corrections — it records the judgement that the book
            was right, which is worth saying out loud.
          </>
        ) : (
          <>
            Accepting writes{' '}
            <strong className="font-semibold text-stone-900">
              {varianceLines} {varianceLines === 1 ? 'correction' : 'corrections'}
            </strong>{' '}
            into the book, moving stock on hand by{' '}
            <strong className="font-mono font-semibold tabular-nums text-stone-900">
              {formatMoneyString(varianceValue)}
            </strong>
            . Each one copies the cost this count froze, not today&rsquo;s.
          </>
        )}
      </p>

      {error !== null && (
        <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium text-stone-900">
            Corrections are events — they can never be edited or deleted afterwards. Accept this count?
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onAccept} disabled={saving} className={btnCls}>
              {saving ? 'Accepting…' : 'Yes — correct the book'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={saving} className={btnGhostCls}>
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={`${btnCls} mt-3 w-full sm:w-auto`}>
          Accept this count into the book
        </button>
      )}
    </section>
  )
}
