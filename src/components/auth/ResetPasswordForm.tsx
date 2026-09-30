'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { resetPasswordWithTokenAction } from '@/server/auth-actions'
import { cardCls, fieldLabelCls, inputCls } from '@/components/ui'

export default function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8 || password !== confirm || busy) return
    setBusy(true)
    setError(null)
    const result = await resetPasswordWithTokenAction({ token, newPassword: password })
    if (result.ok) router.push('/login?reset=done')
    else setError(result.error)
    setBusy(false)
  }
  return (
    <form onSubmit={submit} className={`${cardCls} mt-5`}>
      <label className="block"><span className={fieldLabelCls}>New password (8+ characters)</span><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} /></label>
      <label className="mt-3 block"><span className={fieldLabelCls}>Confirm new password</span><input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} /></label>
      {password !== confirm && confirm !== '' && <p className="mt-2 text-sm text-red-700">The passwords do not match.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy || password.length < 8 || password !== confirm} className="mt-4 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white disabled:bg-stone-300">{busy ? 'Saving…' : 'Set new password'}</button>
    </form>
  )
}
