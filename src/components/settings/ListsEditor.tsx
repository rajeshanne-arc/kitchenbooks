'use client'

// The Lists screen (LAW 2): every categorical field in the app reads one
// of these seven lists. Add a value, reorder, retire — never delete;
// history keeps its words, and a retired value simply stops being
// offered. Free text lives on only in notes and descriptions.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ListOptionRow } from '@/lib/lists'
import { LIST_KEYS } from '@/lib/lists'
import { addListOption, moveListOption, setListOptionStatus } from '@/server/settings-actions'
import { cardCls, numCls } from '@/components/ui'
import { toast } from '@/components/Toasts'
import SaveAck from '@/components/SaveAck'
import DiscardControl from '@/components/books/DiscardControl'

export default function ListsEditor({ initialOptions }: { initialOptions: ListOptionRow[] }) {
  const router = useRouter()
  const [options, setOptions] = useState(initialOptions)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)

  // SILENT ON SUCCESS until now: the row list re-rendered and nothing said
  // what had happened. `ok` is required rather than optional, so a new call
  // site cannot quietly reintroduce the silence.
  async function run(
    p: Promise<{ ok: true; options: ListOptionRow[] } | { ok: false; error: string }>,
    ok: (options: ListOptionRow[]) => { headline: string; sub?: string },
  ) {
    if (busy) return
    setBusy(true)
    try {
      const res = await p
      if (res.ok) {
        setOptions(res.options)
        setAck(ok(res.options))
        router.refresh()
      } else {
        toast(res.error, 'error')
      }
    } catch {
      toast('Could not reach the server — nothing was changed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {ack !== null && <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />}
      {LIST_KEYS.map(({ key, name, usedBy }) => {
        const rows = options.filter((o) => o.list_key === key)
        const draft = drafts[key] ?? ''
        return (
          <section key={key} className={cardCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-stone-900">{name}</h2>
              <span className="text-xs text-stone-400">{usedBy}</span>
            </div>
            <ul className="mt-2 divide-y divide-rule-soft">
              {rows.map((o, i) => (
                <li key={o.id} className="py-1.5">
                  <div className="flex items-center justify-between gap-2">
                  <span className={`min-w-0 truncate text-sm ${o.status === 'inactive' ? 'text-stone-400 line-through' : 'text-stone-900'}`}>
                    {o.value}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={busy || i === 0}
                      onClick={() => void run(moveListOption(o.id, 'up'), () => ({ headline: `“${o.value}” moved up`, sub: `The ${name} list is offered in this order everywhere it appears.` }))}
                      aria-label={`Move ${o.value} up`}
                      className="rounded-md px-1.5 py-0.5 text-sm text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={busy || i === rows.length - 1}
                      onClick={() => void run(moveListOption(o.id, 'down'), () => ({ headline: `“${o.value}” moved down`, sub: `The ${name} list is offered in this order everywhere it appears.` }))}
                      aria-label={`Move ${o.value} down`}
                      className="rounded-md px-1.5 py-0.5 text-sm text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    {o.status === 'active' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(setListOptionStatus(o.id, 'inactive'), (opts) => ({ headline: `“${o.value}” retired`, sub: `Every entry that already used it keeps it — it simply stops being offered. ${opts.filter((r) => r.list_key === key && r.status === 'active').length} values left on ${name}.` }))}
                        className="rounded-md border border-stone-200 px-2 py-0.5 text-xs font-medium text-stone-500 hover:border-amber-300 hover:text-amber-700 disabled:opacity-40"
                      >
                        retire
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(setListOptionStatus(o.id, 'active'), (opts) => ({ headline: `“${o.value}” is offered again`, sub: `${opts.filter((r) => r.list_key === key && r.status === 'active').length} values on ${name}.` }))}
                        className="rounded-md border border-stone-200 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:border-emerald-300 disabled:opacity-40"
                      >
                        restore
                      </button>
                    )}
                  </span>
                  </div>
                  {/* RETIRE AND DISCARD SAY DIFFERENT THINGS. Retiring keeps
                      the word on every entry that already used it and stops
                      offering it; discarding says it was never real — a
                      mistyped value nothing ever used. Only a value nothing
                      points at can be discarded, and the owner decides. */}
                  {o.status === 'active' && (
                    <DiscardControl entity="list_value" id={o.id} label={o.value} noun="list value" />
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && draft.trim() !== '') {
                    void run(addListOption(key, draft.trim()), (opts) => ({ headline: `“${draft.trim()}” added to ${name}`, sub: `${opts.filter((r) => r.list_key === key && r.status === 'active').length} values on this list, offered in the order shown.` })).then(() => setDrafts((d) => ({ ...d, [key]: '' })))
                  }
                }}
                placeholder="add a value"
                className={`${numCls} w-full`}
                maxLength={60}
              />
              <button
                type="button"
                disabled={busy || draft.trim() === ''}
                onClick={() => void run(addListOption(key, draft.trim()), (opts) => ({ headline: `“${draft.trim()}” added to ${name}`, sub: `${opts.filter((r) => r.list_key === key && r.status === 'active').length} values on this list, offered in the order shown.` })).then(() => setDrafts((d) => ({ ...d, [key]: '' })))}
                className="shrink-0 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
              >
                Add
              </button>
            </div>
          </section>
        )
      })}
      <p className="text-center text-xs text-stone-400">
        Retire, never delete — history keeps its words; a retired value just stops being offered.
      </p>
    </div>
  )
}
