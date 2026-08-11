'use client'

import { useState } from 'react'
import { login } from '@/server/auth-actions'
import { btnCls, cardCls, fieldLabelCls, inputCls } from '@/components/ui'

export default function LoginForm({ next }: { next: string }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || username.trim() === '' || password === '') return
    setBusy(true)
    setError(null)
    try {
      const res = await login({ username: username.trim(), password })
      if (res.ok) {
        window.location.assign(next)
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — please retry.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className={`${cardCls} mt-5`}>
      <label className="block">
        <span className={fieldLabelCls}>Username</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          className={inputCls}
          maxLength={60}
        />
      </label>
      <label className="mt-3 block">
        <span className={fieldLabelCls}>Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className={inputCls}
          maxLength={200}
        />
      </label>
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || username.trim() === '' || password === ''}
        className={`${btnCls} mt-4 w-full`}
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="mt-3 text-center text-xs text-stone-400">No account? Ask an owner to create one for you.</p>
    </form>
  )
}
