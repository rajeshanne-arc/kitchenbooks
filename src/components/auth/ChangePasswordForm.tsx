'use client'

import { useState } from 'react'
import { changeOwnPasswordAction } from '@/server/auth-actions'
import { toast } from '@/components/Toasts'
import { fieldLabelCls, inputCls } from '@/components/ui'

export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = !busy && currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const result = await changeOwnPasswordAction({ currentPassword, newPassword })
      if (result.ok) {
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        toast('Password changed')
      } else {
        setError(result.error)
      }
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-md rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="font-display text-lg font-bold text-stone-900">Change password</h2>
      <p className="mt-1 text-sm text-stone-600">Enter your current password first. Owner resets remain available from User accounts.</p>
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className={fieldLabelCls}>Current password</span>
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>New password (8+ characters)</span>
          <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Confirm new password</span>
          <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} />
        </label>
      </div>
      {newPassword.length > 0 && newPassword !== confirmPassword && <p className="mt-2 text-sm text-red-700">The new passwords do not match.</p>}
      {error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>}
      <button type="button" onClick={() => void save()} disabled={!canSave} className="mt-4 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300">
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </div>
  )
}
