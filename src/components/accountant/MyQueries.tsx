'use client'

// What the accountant is asking YOU, on your own home screen.
//
// This is the half of the loop that makes it work. A question in WhatsApp is
// a question someone has to remember; a question here is on the screen they
// already open every morning, and it does not go away until it is answered.
//
// Answering does NOT resolve it. The accountant asked, so the accountant
// decides whether the answer settles it — and often the real fix is a
// reversal and a re-entry, because events here are immutable.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { QueryRow } from '@/lib/types'
import { answerQuery } from '@/server/accountant-actions'
import { entityLabel } from '@/lib/query-entities'
import { fmtDate } from '@/lib/format'
import { btnCls, cardCls, inputCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'
import SaveAck from '@/components/SaveAck'

export default function MyQueries({ queries }: { queries: QueryRow[] }) {
  const router = useRouter()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  if (queries.length === 0) return null

  async function send(id: string) {
    const answer = (drafts[id] ?? '').trim()
    if (answer === '' || busy !== null) return
    setBusy(id)
    try {
      const res = await answerQuery({ id, answer })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      setAck({ headline: 'Answered — the accountant sees it on their queue', sub: 'Answered is not resolved: they decide whether the answer settles it, and the period stays open until they do.' })
      toast('Answered — the accountant will see it', 'ok')
      setDrafts((d) => ({ ...d, [id]: '' }))
      router.refresh()
    } catch {
      toast('Could not reach the server — the answer was not sent.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={`${cardCls} border-amber-300`}>
      {ack !== null && (
        <div className="mb-3">
          <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>The accountant is asking</h2>
        <span className="text-xs text-stone-400">
          {queries.length} {queries.length === 1 ? 'question' : 'questions'}
        </span>
      </div>
      <ul className="mt-2 divide-y divide-rule-soft">
        {queries.map((q) => (
          <li key={q.id} className="py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
              {entityLabel(q.entity_type)}
              {q.entity_date !== null && ` · ${fmtDate(q.entity_date)}`}
            </p>
            <p className="mt-0.5 text-sm text-stone-900">{q.question}</p>
            <div className="mt-1.5 flex items-start gap-2">
              <textarea
                value={drafts[q.id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                rows={2}
                maxLength={2000}
                placeholder="Answer in your own words. If the entry is wrong, void it and enter it again — then say so here."
                className={`${inputCls} flex-1`}
              />
              <button
                type="button"
                disabled={busy !== null || (drafts[q.id] ?? '').trim() === ''}
                onClick={() => void send(q.id)}
                className={`${btnCls} shrink-0 px-3 py-2 text-sm`}
              >
                {busy === q.id ? '…' : 'Send'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
