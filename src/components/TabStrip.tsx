'use client'

// The group tab strip (LAW 3). Tabs arrive resolved — settings-ordered,
// settings-labelled, matrix-filtered — this only paints them and lights
// the active one. Longest matching href wins, so '/kitchen/indent' lights
// Indent, not Dashboard.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { TabDef } from '@/lib/tabs'

export default function TabStrip({ tabs }: { tabs: TabDef[] }) {
  const pathname = usePathname()
  const active = tabs.reduce<TabDef | null>((best, t) => {
    const match = pathname === t.href || pathname.startsWith(`${t.href}/`)
    if (!match) return best
    return best === null || t.href.length > best.href.length ? t : best
  }, null)
  return (
    <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-stone-200 px-4 pb-2 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`inline-flex min-h-[40px] items-center rounded-lg px-2.5 text-[13px] font-medium transition-colors sm:text-sm ${
            active?.key === t.key ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
