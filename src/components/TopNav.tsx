'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function TopNav() {
  const pathname = usePathname()
  const links = [
    { href: '/' as const, label: 'New bill', active: pathname === '/' },
    { href: '/books/bills' as const, label: 'Books', active: pathname.startsWith('/books') },
  ]
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-2xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-[15px] font-bold tracking-tight text-emerald-800">
          KitchenBooks
        </Link>
        <nav className="flex gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                l.active ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
