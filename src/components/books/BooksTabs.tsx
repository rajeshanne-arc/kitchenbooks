'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/books/bills' as const, label: 'Bills' },
  { href: '/books/vendors' as const, label: 'Vendors' },
  { href: '/books/items' as const, label: 'Items' },
]

export default function BooksTabs() {
  const pathname = usePathname()
  return (
    <nav className="mt-3 flex gap-6 border-b border-stone-200">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium ${
              active
                ? 'border-emerald-700 text-emerald-800'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
