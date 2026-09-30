'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setMembershipStatusAction } from '@/server/auth-actions'
import type { RestaurantMembershipRow } from '@/lib/types'
import { toast } from '@/components/Toasts'

export default function MembershipsAdmin({ rows, self }: { rows: RestaurantMembershipRow[]; self: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(row: RestaurantMembershipRow) {
    setBusy(row.membership_id)
    setError(null)
    const status = row.status === 'active' ? 'inactive' : 'active'
    try {
      const result = await setMembershipStatusAction(row.membership_id, status)
      if (result.ok) {
        toast(`${row.username}${status === 'active' ? ' restored' : ' retired'} for this restaurant`)
        router.refresh()
      } else setError(result.error)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="font-display text-lg font-bold text-stone-900">Restaurant access</h2>
      <p className="mt-1 text-sm text-stone-600">These memberships control access to this restaurant. Retiring one does not delete the person’s global account.</p>
      <ul className="mt-3 divide-y divide-stone-100">
        {rows.map((row) => (
          <li key={row.membership_id} className="flex items-center justify-between gap-3 py-2.5">
            <span className={row.status === 'inactive' ? 'opacity-50' : ''}>
              <span className="block text-sm font-medium text-stone-900">{row.display_name} <span className="font-mono text-xs text-stone-400">@{row.username}</span>{row.username === self && <span className="ml-1 text-xs text-emerald-700">(you)</span>}</span>
              <span className="text-xs text-stone-500">{row.role}{row.status !== 'active' && ` · ${row.status}`}</span>
            </span>
            <button type="button" disabled={busy !== null} onClick={() => void toggle(row)} className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:border-stone-400 disabled:opacity-50">
              {busy === row.membership_id ? 'Saving…' : row.status === 'active' ? 'Retire here' : 'Restore here'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>}
    </section>
  )
}
