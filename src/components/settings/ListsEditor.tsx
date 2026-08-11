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

export default function ListsEditor({ initialOptions }: { initialOptions: ListOptionRow[] }) {
  const router = useRouter()
  const [options, setOptions] = useState(initialOptions)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function run(p: Promise<{ ok: true; options: ListOptionRow[] } | { ok: false; error: string }>) {
    if (busy) return
    setBusy(true)
    try {
      const res = await p
      if (res.ok) {
        setOptions(res.options)
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
                <li key={o.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className={`min-w-0 truncate text-sm ${o.status === 'inactive' ? 'text-stone-400 line-through' : 'text-stone-900'}`}>
                    {o.value}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={busy || i === 0}
                      onClick={() => void run(moveListOption(o.id, 'up'))}
                      aria-label={`Move ${o.value} up`}
                      className="rounded-md px-1.5 py-0.5 text-sm text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={busy || i === rows.length - 1}
                      onClick={() => void run(moveListOption(o.id, 'down'))}
                      aria-label={`Move ${o.value} down`}
                      className="rounded-md px-1.5 py-0.5 text-sm text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    {o.status === 'active' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(setListOptionStatus(o.id, 'inactive'))}
                        className="rounded-md border border-stone-200 px-2 py-0.5 text-xs font-medium text-stone-500 hover:border-amber-300 hover:text-amber-700 disabled:opacity-40"
                      >
                        retire
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(setListOptionStatus(o.id, 'active'))}
                        className="rounded-md border border-stone-200 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:border-emerald-300 disabled:opacity-40"
                      >
                        restore
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && draft.trim() !== '') {
                    void run(addListOption(key, draft.trim())).then(() => setDrafts((d) => ({ ...d, [key]: '' })))
                  }
                }}
                placeholder="add a value"
                className={`${numCls} w-full`}
                maxLength={60}
              />
              <button
                type="button"
                disabled={busy || draft.trim() === ''}
                onClick={() => void run(addListOption(key, draft.trim())).then(() => setDrafts((d) => ({ ...d, [key]: '' })))}
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
