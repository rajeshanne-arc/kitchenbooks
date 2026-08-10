'use client'

// Creates the FIRST owner account, exactly once. The bootstrap code is the
// current door PIN — typed here at the screen, never sent through anyone.
// After this succeeds, /setup refuses forever and KB_PIN can be deleted
// from the environment.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setupFirstOwner } from '@/server/auth-actions'
import { cardCls, fieldLabelCls, inputCls } from '@/components/ui'

export default function SetupForm() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [bootstrapCode, setBootstrapCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = !busy && username.trim() !== '' && displayName.trim() !== '' && password.length >= 8 && bootstrapCode.trim() !== ''

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await setupFirstOwner({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        bootstrapCode: bootstrapCode.trim(),
      })
      if (res.ok) {
        router.push('/')
        router.refresh()
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
      <p className="text-sm text-stone-600">
        This creates the <span className="font-semibold">first owner account</span> and then closes forever. Owners
        add everyone else from Books → Users.
      </p>
      <label className="mt-4 block">
        <span className={fieldLabelCls}>Username</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" className={inputCls} maxLength={30} />
      </label>
      <label className="mt-3 block">
        <span className={fieldLabelCls}>Your name</span>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} maxLength={80} />
      </label>
      <label className="mt-3 block">
        <span className={fieldLabelCls}>Password (8+ characters)</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={inputCls} maxLength={200} />
      </label>
      <label className="mt-3 block">
        <span className={fieldLabelCls}>Bootstrap code — the current door PIN</span>
        <input inputMode="numeric" value={bootstrapCode} onChange={(e) => setBootstrapCode(e.target.value)} className={inputCls} maxLength={20} />
      </label>
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!canSave}
        className="mt-4 w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {busy ? 'Creating…' : 'Create the owner account'}
      </button>
      <p className="mt-3 text-xs text-stone-400">
        Once this succeeds, delete the KB_PIN variable from Vercel — the login is the door now.
      </p>
    </form>
  )
}
