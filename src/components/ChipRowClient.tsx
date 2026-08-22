'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ChipDef } from '@/lib/tabs'
import type { ChipBadges } from '@/components/ChipRow'

export default function ChipRowClient({
  base,
  chips,
  badges = {},
}: {
  base: string
  chips: ChipDef[]
  badges?: ChipBadges
}) {
  const pathname = usePathname()
  if (chips.length === 0) return null
  return (
    // data-chrome: app furniture, and furniture does not print. A vendor
    // holding a printed statement cannot navigate anywhere.
    <div
      data-chrome="true"
      className="-mx-4 mb-4 flex items-center gap-2 overflow-x-auto whitespace-nowrap px-4 sm:mx-0 sm:px-0"
    >
      {chips.map((c, i) => {
        const href = `${base}/${c.key}`
        // The parent URL now RENDERS the first chip instead of redirecting to
        // it, so the first chip has to light up there too — otherwise a tab
        // click lands on a screen with nothing marked and the row reads as
        // broken. `base` itself is the first chip.
        const active =
          pathname === href || pathname.startsWith(`${href}/`) || (i === 0 && pathname === base)
        const count = badges[c.key] ?? 0
        return (
          <span key={c.key} className="inline-flex items-center gap-2">
            {/* A RULE, NOT A GAP. It separates chips that ADD ROWS from one
                that changes what every number means — and it is skipped when
                the chip before it was filtered away, so a lone chip never
                arrives wearing a divider to nothing. */}
            {c.separatorBefore === true && i > 0 && (
              <span aria-hidden className="h-6 w-px shrink-0 bg-rule" />
            )}
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors sm:text-sm ${
                active
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-rule bg-cell text-stone-600 hover:border-stone-400 hover:text-stone-900'
              }`}
            >
              {c.label}
              {count > 0 && (
                <span
                  className={`inline-flex min-w-[18px] justify-center rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums ${
                    active ? 'bg-white text-emerald-800' : 'bg-amber-200 text-amber-900'
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          </span>
        )
      })}
    </div>
  )
}
