'use client'

// A chip row sits under a consolidated tab and swaps in ONE small focused
// form. It is deliberately not a single large form with conditional fields:
// one question at a time still rules. Each chip is a real URL, so a form can
// be bookmarked, linked to and returned to.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ChipDef } from '@/lib/tabs'

export default function ChipRow({ base, chips }: { base: string; chips: ChipDef[] }) {
  const pathname = usePathname()
  if (chips.length === 0) return null
  return (
    // data-chrome: app furniture, and furniture does not print. A vendor
    // holding a printed statement cannot navigate anywhere.
    <div
      data-chrome="true"
      className="-mx-4 mb-4 flex gap-2 overflow-x-auto whitespace-nowrap px-4 sm:mx-0 sm:px-0"
    >
      {chips.map((c) => {
        const href = `${base}/${c.key}`
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={c.key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-[40px] items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors sm:text-sm ${
              active
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-rule bg-cell text-stone-600 hover:border-stone-400 hover:text-stone-900'
            }`}
          >
            {c.label}
          </Link>
        )
      })}
    </div>
  )
}
