'use client'

// You only see what you can open — the links come from the same role
// matrix the proxy enforces. The name on the key is always visible, with
// the way out beside it.

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { navFor, type Role } from '@/lib/roles'
import { LangToggle } from '@/components/useLang'
import { logout } from '@/server/auth-actions'

export type NavUser = { username: string; displayName: string; role: Role }

export default function TopNav({ user }: { user: NavUser | null }) {
  const pathname = usePathname()
  const router = useRouter()

  async function onLogout() {
    try {
      await logout()
    } finally {
      router.push('/login')
      router.refresh()
    }
  }

  const links = user === null ? [] : navFor(user.role)

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-2xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link href="/" className="shrink-0 text-[15px] font-bold tracking-tight text-emerald-800">
          KB
        </Link>
        {user !== null && (
          <>
            <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto whitespace-nowrap sm:gap-1">
              {links.map((l) => {
                const active = l.activePrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`rounded-lg px-2 py-1.5 text-[13px] font-medium sm:px-2.5 sm:text-sm ${
                      active ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    {l.label}
                  </Link>
                )
              })}
            </nav>
            <LangToggle />
            <button
              type="button"
              onClick={() => void onLogout()}
              title={`Signed in as ${user.displayName} (${user.role}) — sign out`}
              className="shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-[11px] font-medium text-stone-500 hover:border-stone-300 hover:text-stone-800"
            >
              {user.username} ⏻
            </button>
          </>
        )}
      </div>
    </header>
  )
}
