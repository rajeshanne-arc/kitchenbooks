'use client'

import { useState } from 'react'
import { login, selectRestaurant } from '@/server/auth-actions'
import { btnCls, cardCls, fieldLabelCls, inputCls } from '@/components/ui'

export default function LoginForm({ next }: { next: string }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [choices, setChoices] = useState<{ restaurantId: string; restaurantName: string; role: string }[] | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || username.trim() === '' || password === '') return
    setBusy(true)
    setError(null)
    try {
      const res = await login({ username: username.trim(), password })
      if (res.ok === true) {
        window.location.assign(next)
      } else if (res.ok === 'choose-restaurant') {
        setChoices(res.choices)
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — please retry.')
    } finally {
      setBusy(false)
    }
  }

  async function chooseRestaurant(restaurantId: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await selectRestaurant(restaurantId)
      if (res.ok) window.location.assign(next)
      else setError(res.error)
    } catch {
      setError('Could not reach the server — please retry.')
    } finally {
      setBusy(false)
    }
  }

  if (choices) {
    return (
      <div className={`${cardCls} mt-5`}>
        <p className="text-sm text-stone-600">Your account has access to more than one restaurant. Choose which books to open.</p>
        <div className="mt-4 space-y-2">
          {choices.map((choice) => (
            <button key={choice.restaurantId} type="button" disabled={busy} onClick={() => void chooseRestaurant(choice.restaurantId)} className="w-full rounded-xl border border-stone-200 px-3 py-3 text-left hover:border-emerald-600 disabled:opacity-50">
              <span className="block font-medium text-stone-900">{choice.restaurantName}</span>
              <span className="text-xs text-stone-500">{choice.role}</span>
            </button>
          ))}
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
    )
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
      <p className="mt-3 text-center text-xs text-stone-500">
        Forgot your password? Ask an owner to open Owner → Setup → Users and generate a one-time reset link for you.
      </p>
    </form>
  )
}
