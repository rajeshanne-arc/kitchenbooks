'use client'

// The books sub-strip, inside a group. Reading screens only — nothing here
// takes an entry.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { BookView } from '@/lib/books'

export default function BooksNav({ views }: { views: BookView[] }) {
  const pathname = usePathname()
  if (views.length <= 1) return null
  return (
    <nav className="-mx-4 mb-4 flex gap-5 overflow-x-auto whitespace-nowrap border-b border-rule px-4 sm:mx-0 sm:px-0">
      {views.map((v) => {
        const active = pathname === v.href || pathname.startsWith(`${v.href}/`)
        return (
          <Link
            key={v.href}
            href={v.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px inline-flex min-h-[40px] items-center border-b-2 px-1 text-sm font-medium ${
              active ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            {v.label}
          </Link>
        )
      })}
    </nav>
  )
}
