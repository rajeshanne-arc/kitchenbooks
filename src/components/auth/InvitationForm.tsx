'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { acceptRestaurantInvitationAction } from '@/server/auth-actions'
import { inputCls } from '@/components/ui'

export default function InvitationForm({ token, username }: { token: string; username: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    if (password.length < 8 || busy) return
    setBusy(true); setError(null)
    try {
      const result = await acceptRestaurantInvitationAction({ token, password })
      if (result.ok) router.push(`/login?invited=${encodeURIComponent(username)}`)
      else setError(result.error)
    } catch { setError('Could not reach the server — the invitation was not accepted.') }
    finally { setBusy(false) }
  }
  return <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
    <p className="text-sm text-stone-600">Choose a password for <strong>@{username}</strong>. It must be at least 8 characters.</p>
    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={`${inputCls} mt-3`} placeholder="Password" maxLength={200} />
    {error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>}
    <button type="button" onClick={() => void submit()} disabled={busy || password.length < 8} className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white disabled:bg-stone-300">{busy ? 'Creating account…' : 'Accept invitation'}</button>
  </div>
}
