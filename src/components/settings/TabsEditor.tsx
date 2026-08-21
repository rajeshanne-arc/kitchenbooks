'use client'

// The tabs screen (LAW 3): each role group's tab strip — ORDER and LABELS
// only. Routes always come from the hardcoded defaults; a tab can be
// renamed or moved, never removed — hiding pages is the role matrix's
// job, not a setting.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TAB_GROUP_NAMES, TAB_GROUPS, type TabDef, type TabGroup } from '@/lib/tabs'
import { saveTabsSetting } from '@/server/settings-actions'
import { cardCls, numCls } from '@/components/ui'
import { toast } from '@/components/Toasts'
import SaveAck from '@/components/SaveAck'

export default function TabsEditor({ initialTabs }: { initialTabs: Record<TabGroup, TabDef[]> }) {
  const router = useRouter()
  const [tabs, setTabs] = useState(initialTabs)
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<TabGroup | null>(null)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)

  function move(group: TabGroup, index: number, dir: -1 | 1) {
    setTabs((t) => {
      const list = [...t[group]]
      const j = index + dir
      if (j < 0 || j >= list.length) return t
      ;[list[index], list[j]] = [list[j], list[index]]
      return { ...t, [group]: list }
    })
    setDirty((d) => ({ ...d, [group]: true }))
  }

  function relabel(group: TabGroup, index: number, label: string) {
    setTabs((t) => {
      const list = [...t[group]]
      list[index] = { ...list[index], label }
      return { ...t, [group]: list }
    })
    setDirty((d) => ({ ...d, [group]: true }))
  }

  async function save(group: TabGroup) {
    if (busy !== null) return
    setBusy(group)
    try {
      const res = await saveTabsSetting(
        group,
        tabs[group].map((t) => ({ key: t.key, label: t.label.trim() })),
      )
      if (res.ok) {
        setTabs((t) => ({ ...t, [group]: res.tabs }))
        setDirty((d) => ({ ...d, [group]: false }))
        setAck({
          headline: `${TAB_GROUP_NAMES[group]} — ${res.tabs.length} tabs, in this order`,
          sub: res.tabs.map((t) => t.label).join(' · '),
        })
        toast(`${TAB_GROUP_NAMES[group]} tabs saved`)
        router.refresh()
      } else {
        toast(res.error, 'error')
      }
    } catch {
      toast('Could not reach the server — nothing was saved.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {ack !== null && <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />}
      {TAB_GROUPS.map((group) => (
        <section key={group} className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-stone-900">{TAB_GROUP_NAMES[group]}</h2>
            <button
              type="button"
              disabled={busy !== null || dirty[group] !== true}
              onClick={() => void save(group)}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
            >
              {busy === group ? 'Saving…' : 'Save order & labels'}
            </button>
          </div>
          <ul className="mt-2 divide-y divide-rule-soft">
            {tabs[group].map((t, i) => (
              <li key={t.key} className="flex items-center gap-2 py-1.5">
                <span className="w-8 shrink-0 text-center font-mono text-[11px] text-stone-400">{i + 1}</span>
                <input
                  value={t.label}
                  onChange={(e) => relabel(group, i, e.target.value)}
                  className={`${numCls} w-full`}
                  maxLength={24}
                  aria-label={`Label for ${t.key}`}
                />
                <span className="hidden w-40 shrink-0 truncate font-mono text-[11px] text-stone-400 sm:block">{t.href}</span>
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => move(group, i, -1)}
                  aria-label={`Move ${t.label} up`}
                  className="rounded-md px-1.5 py-0.5 text-sm text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={i === tabs[group].length - 1}
                  onClick={() => move(group, i, 1)}
                  aria-label={`Move ${t.label} down`}
                  className="rounded-md px-1.5 py-0.5 text-sm text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                >
                  ↓
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-center text-xs text-stone-400">
        Order and labels only — what a role can SEE is the role matrix&apos;s law, not a setting.
      </p>
    </div>
  )
}
