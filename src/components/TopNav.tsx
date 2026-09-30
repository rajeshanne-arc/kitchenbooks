'use client'

// You only see what you can open — the links come from the same role
// matrix the proxy enforces. The name on the key is always visible, with
// the way out beside it.

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { navFor, type Role } from '@/lib/roles'
import { LangToggle } from '@/components/useLang'
import { logout } from '@/server/auth-actions'
import { switchRestaurantAction } from '@/server/auth-actions'
import type { LoginMembershipChoice } from '@/lib/types'

export type NavUser = { username: string; displayName: string; role: Role; restaurantId: string; memberships?: LoginMembershipChoice[] }

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

  async function onSwitch(restaurantId: string) {
    const result = await switchRestaurantAction(restaurantId)
    if (result.ok) router.refresh()
  }

  const links = user === null ? [] : navFor(user.role)

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-cell/95 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="shrink-0 font-display text-[15px] font-bold tracking-[-0.02em] text-emerald-800"
        >
          KB
        </Link>
        {user === null && (
          <>
            <nav className="hidden items-center gap-5 text-xs font-medium text-stone-500 sm:flex">
              <a href="#how-it-works" className="hover:text-stone-900">How it works</a>
              <a href="#roles" className="hover:text-stone-900">Roles</a>
            </nav>
            <Link href="/login" className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800">Sign in</Link>
          </>
        )}
        {user !== null && (
          <>
            <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto whitespace-nowrap sm:gap-1">
              {links.map((l) => {
                const active = l.activePrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`inline-flex min-h-[40px] items-center rounded-lg px-2 text-[13px] font-medium transition-colors sm:px-2.5 sm:text-sm ${
                      active ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    {l.label}
                  </Link>
                )
              })}
            </nav>
            <Link
              href="/sops"
              className="hidden shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-[11px] font-medium text-stone-500 hover:border-stone-300 hover:text-stone-800 sm:inline-flex"
            >
              Your day
            </Link>
            <LangToggle />
            {user.memberships && user.memberships.length > 1 && (
              <select
                aria-label="Current restaurant"
                value={user.restaurantId}
                onChange={(event) => void onSwitch(event.target.value)}
                className="hidden max-w-[130px] rounded-lg border border-stone-200 bg-white px-1.5 py-1 text-[11px] text-stone-600 sm:block"
              >
                {user.memberships.map((item) => <option key={item.restaurantId} value={item.restaurantId}>{item.restaurantName}</option>)}
              </select>
            )}
            <Link
              href="/account/security"
              className="hidden shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-[11px] font-medium text-stone-500 hover:border-stone-300 hover:text-stone-800 sm:inline-flex"
            >
              Account
            </Link>
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
