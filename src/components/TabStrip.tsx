'use client'

// The group tab strip (LAW 3). Tabs arrive resolved — settings-ordered,
// settings-labelled, matrix-filtered — this only paints them and lights
// the active one. Longest matching href wins, so '/kitchen/indent' lights
// Indent, not Dashboard.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { TabBadges, TabDef } from '@/lib/tabs'

export default function TabStrip({ tabs, badges = {} }: { tabs: TabDef[]; badges?: TabBadges }) {
  const pathname = usePathname()
  const active = tabs.reduce<TabDef | null>((best, t) => {
    const match = pathname === t.href || pathname.startsWith(`${t.href}/`)
    if (!match) return best
    return best === null || t.href.length > best.href.length ? t : best
  }, null)
  return (
    <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-stone-200 px-4 pb-2 sm:mx-0 sm:px-0">
      {tabs.map((t) => {
        const count = badges[t.key] ?? 0
        const on = active?.key === t.key
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors sm:text-sm ${
              on ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            {t.label}
            {count > 0 && (
              <span
                // zero-state silent: this whole element is absent at 0
                className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                  on ? 'bg-white/25 text-white' : 'bg-amber-200 text-amber-900'
                }`}
              >
                {count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
