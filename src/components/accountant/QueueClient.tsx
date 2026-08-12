'use client'

// The accountant's queue. Their home screen is a QUEUE, not a form: what is
// being asked, by whom, of whom, and how long it has been waiting.
//
// Raising a query is the one form here and it stays small — what it is
// about, who should answer, and the question itself. The entity is optional
// detail because half of a real month-end list is "why was Tuesday short?",
// which has no single row behind it.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { QueryRow } from '@/lib/types'
import type { Role } from '@/lib/roles'
import { raiseQuery, resolveQuery } from '@/server/accountant-actions'
import { QUERY_ENTITIES, ASSIGNABLE_ROLES, entityDefaultRole, entityLabel } from '@/lib/query-entities'
import { fmtDate, fmtDateTime } from '@/lib/format'
import {
  btnCls,
  btnGhostCls,
  cardCls,
  fieldLabelCls,
  inputCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'
import { toast } from '@/components/Toasts'

const ROLE_LABEL: Record<Role, string> = {
  store: 'Store',
  cashier: 'Cashier',
  chef: 'Chef',
  manager: 'Manager',
  owner: 'Owner',
  accountant: 'Accountant',
}

/** How long it has been waiting — the only number on a query that grows. */
function waiting(raisedAt: string): string {
  const days = Math.floor((Date.now() - new Date(raisedAt).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day'
  return `${days} days`
}

export default function QueueClient({ open, recent }: { open: QueryRow[]; recent: QueryRow[] }) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [entityType, setEntityType] = useState('')
  const [entityDate, setEntityDate] = useState('')
  const [assignedRole, setAssignedRole] = useState('')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const canAsk = entityType !== '' && assignedRole !== '' && question.trim().length >= 3

  // Picking what it is about SUGGESTS who answers — a purchase is the
  // store's, a day close is the cashier's. Suggests, never decides: the
  // select stays there and stays editable.
  function pickEntity(key: string) {
    setEntityType(key)
    if (key !== '' && assignedRole === '') setAssignedRole(entityDefaultRole(key))
  }

  async function ask() {
    if (!canAsk || busy !== null) return
    setBusy('ask')
    try {
      const res = await raiseQuery({ entityType, entityId: '', entityDate, question, assignedRole })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      toast(`Asked of the ${ROLE_LABEL[res.query.assigned_role].toLowerCase()}`, 'ok')
      setEntityType('')
      setEntityDate('')
      setAssignedRole('')
      setQuestion('')
      setAsking(false)
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was asked.', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function resolve(id: string) {
    if (busy !== null) return
    setBusy(id)
    try {
      const res = await resolveQuery(id)
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      toast('Resolved', 'ok')
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was changed.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Questions out</h2>
          <span className="text-xs text-stone-400">
            {open.length === 0 ? 'nothing waiting' : `${open.length} waiting`}
          </span>
        </div>

        {open.length === 0 ? (
          <p className="mt-1.5 text-sm text-stone-700">
            Nothing is being asked. A month with no open questions is a month that can close.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-rule-soft">
            {open.map((q) => (
              <li key={q.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                    {entityLabel(q.entity_type)}
                    {q.entity_date !== null && ` · ${fmtDate(q.entity_date)}`}
                  </span>
                  <span className="shrink-0 text-[11px] text-stone-400">
                    {ROLE_LABEL[q.assigned_role]} · {waiting(q.raised_at)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-stone-900">{q.question}</p>
                {q.answer !== null ? (
                  <div className="mt-1.5 rounded-lg border border-rule bg-paper px-2.5 py-2">
                    <p className="text-sm text-stone-800">{q.answer}</p>
                    <p className="mt-0.5 text-[11px] text-stone-400">
                      {q.answered_by ?? 'someone'} · {q.answered_at === null ? '' : fmtDateTime(q.answered_at)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-amber-800">waiting for an answer</p>
                )}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void resolve(q.id)}
                  className="mt-1.5 rounded-lg border border-rule px-2.5 py-1 text-xs font-medium text-stone-600 hover:border-emerald-300 hover:text-emerald-800 disabled:opacity-40"
                >
                  {busy === q.id ? '…' : 'Mark resolved'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {asking ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Ask a question</h2>
          <div className="mt-2 space-y-3">
            <label className="block">
              <span className={fieldLabelCls}>About</span>
              <select value={entityType} onChange={(e) => pickEntity(e.target.value)} className={selectCls}>
                <option value="">—</option>
                {QUERY_ENTITIES.map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={fieldLabelCls}>Which day (optional)</span>
                <input
                  type="date"
                  value={entityDate}
                  onChange={(e) => setEntityDate(e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Who answers</span>
                <select
                  value={assignedRole}
                  onChange={(e) => setAssignedRole(e.target.value)}
                  className={selectCls}
                >
                  <option value="">—</option>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className={fieldLabelCls}>The question</span>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Ask it the way you would on the phone."
                className={inputCls}
              />
            </label>

            <p className="text-xs text-stone-500">
              It lands on their home screen the moment you ask. Nothing closes the month until it is
              resolved.
            </p>

            <div className="flex gap-2">
              <button type="button" disabled={!canAsk || busy !== null} onClick={() => void ask()} className={btnCls}>
                {busy === 'ask' ? 'Asking…' : 'Ask'}
              </button>
              <button type="button" onClick={() => setAsking(false)} className={btnGhostCls}>
                Cancel
              </button>
            </div>
          </div>
        </section>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className={btnCls}>
          Ask a question
        </button>
      )}

      {recent.length > 0 && (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Settled</h2>
          <p className="mt-1 text-xs text-stone-500">
            The question and the answer both stay — in a month&apos;s time the answer is the only thing
            that explains the number.
          </p>
          <ul className="mt-2 divide-y divide-rule-soft">
            {recent.map((q) => (
              <li key={q.id} className="py-2">
                <p className="text-sm text-stone-700">{q.question}</p>
                {q.answer !== null && <p className="mt-0.5 text-sm text-stone-500">{q.answer}</p>}
                <p className="mt-0.5 text-[11px] text-stone-400">
                  {entityLabel(q.entity_type)} · asked by {q.raised_by ?? '—'} · resolved by{' '}
                  {q.resolved_by ?? '—'}
                  {q.resolved_at !== null && ` · ${fmtDate(q.resolved_at.slice(0, 10))}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
