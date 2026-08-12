'use client'

// Take a match back.
//
// The only DELETE on the accounting side of this app, and it is the right
// shape here for the same reason the rule exists everywhere else. Every
// other table holds an EVENT — money moved, goods arrived, somebody worked
// a day — and an event cannot be made not to have happened, so it is
// corrected with a reversal. A match holds a JUDGEMENT: that this statement
// line and that movement are the same transaction. A judgement that turns
// out to be wrong was never true, so there is nothing to preserve and
// nothing to reverse; keeping it beside a correction would assert two
// contradictory things and leave `unmatched_lines` wrong forever.
//
// Same exception as `recipe_lines`: removing an ingredient from a card is
// editing a description, not erasing history.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { unmatchStatementLine } from '@/server/reconciliation-actions'
import { toast } from '@/components/Toasts'

export default function UnmatchButton({
  statementLineId,
  label,
}: {
  statementLineId: string
  /** what the row is, so the confirm names it rather than saying "this" */
  label: string
}) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [pending, start] = useTransition()

  function run() {
    start(async () => {
      try {
        const res = await unmatchStatementLine(statementLineId)
        if (!res.ok) {
          toast(res.error, 'error')
          return
        }
        toast('Unmatched — both sides are free to match again', 'ok')
        setAsking(false)
        router.refresh()
      } catch {
        toast('Could not reach the server — nothing was changed.', 'error')
      }
    })
  }

  // Asked once, in words, because unmatching frees a movement somebody else
  // may be looking at — but not dwelt on: it is a correctable action, and
  // treating it as grave would discourage the fix it exists to allow.
  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="rounded-lg border border-rule px-2 py-1 text-xs font-medium text-stone-500 hover:border-amber-300 hover:text-amber-800"
      >
        unmatch
      </button>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-stone-600">Unmatch {label}?</span>
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 disabled:opacity-50"
      >
        {pending ? '…' : 'Yes'}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="rounded-lg px-2 py-1 text-xs text-stone-500 hover:text-stone-800"
      >
        no
      </button>
    </span>
  )
}
