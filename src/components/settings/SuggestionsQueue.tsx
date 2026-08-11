'use client'

// The owner's approval queue.
//
// These values are ALREADY SAVED on the entries that used them. This is not
// a gate the entry had to pass — the person with the receipt could not wait
// for an owner to log in, so the entry went through and the word landed
// here. What the owner decides is whether it becomes vocabulary the app
// offers next time.
//
// seen_count is the signal worth reading: a word typed nine times is real,
// a word typed once is probably a typo.
//
// An expense category cannot be approved without saying controllable or
// occupancy, because the P&L splits on exactly that and an unclassified
// category would land in neither.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ListSuggestionRow } from '@/lib/lists'
import { approveSuggestion, rejectSuggestion } from '@/server/settings-actions'
import { cardCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function SuggestionsQueue({ rows }: { rows: ListSuggestionRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function approve(row: ListSuggestionRow, kind?: 'controllable' | 'occupancy') {
    setBusy(row.id)
    setError(null)
    try {
      const res = await approveSuggestion(row.id, kind)
      if (res.ok) {
        toast(`“${row.value}” is now on the ${row.list_key.replace(/_/g, ' ')} list`)
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was changed.')
    } finally {
      setBusy(null)
    }
  }

  async function reject(row: ListSuggestionRow) {
    setBusy(row.id)
    setError(null)
    try {
      const res = await rejectSuggestion(row.id)
      if (res.ok) {
        toast(`“${row.value}” will not be offered again`)
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was changed.')
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) {
    return (
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Nothing waiting</h2>
        <p className="mt-1.5 text-sm text-stone-700">
          Every word typed into a list field so far is already on its list.
        </p>
      </section>
    )
  }

  return (
    <section className={`${cardCls} border-amber-300 bg-amber-50/30`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Waiting for you</h2>
        <span className="font-mono text-[10px] text-stone-400">list_suggestions</span>
      </div>
      <p className="mt-1 text-xs text-stone-600">
        These are already saved on the entries that used them. Approving adds the word to its list so the app
        offers it next time; rejecting only stops it being offered — nothing already recorded changes.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
          {error}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {rows.map((r) => {
          const isExpense = r.list_key === 'expense_category'
          return (
            <li key={r.id} className="rounded-xl border border-rule bg-cell p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px] font-medium text-stone-900">{r.value}</span>
                <span className="text-xs text-stone-500">
                  {r.list_key.replace(/_/g, ' ')} · typed {r.seen_count}{' '}
                  {r.seen_count === 1 ? 'time' : 'times'}
                  {r.suggested_by !== null && ` · first by ${r.suggested_by}`}
                </span>
              </div>

              {isExpense ? (
                <>
                  <p className="mt-2 text-xs text-stone-600">
                    The P&amp;L splits controllable from occupancy — say which before this becomes a category.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void approve(r, 'controllable')}
                      className="min-h-[40px] rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
                    >
                      Approve — controllable
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void approve(r, 'occupancy')}
                      className="min-h-[40px] rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
                    >
                      Approve — occupancy
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void reject(r)}
                      className="min-h-[40px] rounded-lg border border-rule px-3 text-xs font-medium text-stone-600 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void approve(r)}
                    className="min-h-[40px] rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
                  >
                    {busy === r.id ? '…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void reject(r)}
                    className="min-h-[40px] rounded-lg border border-rule px-3 text-xs font-medium text-stone-600 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
