'use client'

// Owner-only account management: create, change role, link to staff,
// reset password, retire. The last active owner can be neither retired
// nor demoted — the server refuses; the button explains.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AppUserRow, StaffRow } from '@/lib/types'
import { createUserAction, issuePasswordResetLinkAction, issueRestaurantInvitationAction, resetPasswordAction, updateUserAction } from '@/server/auth-actions'
import { ALL_ROLES } from '@/lib/roles'
import { cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

type StaffOpt = Pick<StaffRow, 'id' | 'code' | 'name'>

function CreateUser({ staff }: { staff: StaffOpt[] }) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('store')
  const [password, setPassword] = useState('')
  const [staffId, setStaffId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = !busy && username.trim() !== '' && displayName.trim() !== '' && password.length >= 8

  async function onSave() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await createUserAction({ username: username.trim(), displayName: displayName.trim(), role, password, staffId })
      if (res.ok) {
        toast(`Account ${res.user.username} created (${res.user.role})`)
        setUsername('')
        setDisplayName('')
        setPassword('')
        setStaffId('')
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`${cardCls} mt-4`}>
      <h2 className={sectionHeadCls}>New account</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelCls}>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" className={inputCls} maxLength={30} />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Display name</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} maxLength={80} />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={selectCls}>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Staff link (optional)</span>
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={selectCls}>
            <option value="">—</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block">
          <span className={fieldLabelCls}>Password (8+ characters — they can ask you to reset it later)</span>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" className={inputCls} maxLength={200} />
        </label>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>}
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {busy ? 'Creating…' : 'Create account'}
      </button>
    </section>
  )
}

function UserRow({ u, staff, self }: { u: AppUserRow; staff: StaffOpt[]; self: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState(u.display_name)
  const [role, setRole] = useState<string>(u.role)
  const [staffId, setStaffId] = useState(u.staff_id ?? '')
  const [newPw, setNewPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetLink, setResetLink] = useState<string | null>(null)

  async function save(status: 'active' | 'inactive') {
    setBusy(true)
    setError(null)
    try {
      const res = await updateUserAction(u.id, { displayName: displayName.trim(), role, staffId, status })
      if (res.ok) {
        toast(
          status === 'inactive'
            ? `${res.user.username} retired — the key stops working now`
            : `${res.user.username} saved (${res.user.role})`,
        )
        setOpen(false)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  async function resetPw() {
    if (newPw.length < 8) return
    setBusy(true)
    setError(null)
    try {
      const res = await resetPasswordAction(u.id, newPw)
      if (res.ok) {
        toast(`Password reset for ${u.username}`)
        setNewPw('')
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  async function issueResetLink() {
    setBusy(true)
    setError(null)
    setResetLink(null)
    try {
      const res = await issuePasswordResetLinkAction(u.id)
      if (res.ok) {
        setResetLink(`${window.location.origin}/reset-password?token=${encodeURIComponent(res.token)}`)
        toast('One-time reset link created — copy it to the user')
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — no link was created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`py-2.5 ${u.status === 'inactive' ? 'opacity-50' : ''}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium text-stone-900">
            {u.display_name} <span className="font-mono text-xs text-stone-400">@{u.username}</span>
            {u.username === self && <span className="ml-1 text-xs text-emerald-700">(you)</span>}
          </span>
          <span className="block text-xs text-stone-500">
            {u.role}
            {u.staff_name !== null && (
              <>
                {' '}
                · {u.staff_code} {u.staff_name}
              </>
            )}
            {u.status === 'inactive' && ' · retired'}
          </span>
        </span>
        <span className="text-stone-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-stone-200 bg-stone-50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Display name</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} maxLength={80} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={selectCls}>
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 block">
              <span className={fieldLabelCls}>Staff link</span>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={selectCls}>
                <option value="">—</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save(u.status)}
              disabled={busy}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Save
            </button>
            {u.status === 'active' ? (
              <button
                type="button"
                onClick={() => void save('inactive')}
                disabled={busy}
                className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Retire key
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void save('active')}
                disabled={busy}
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 disabled:opacity-50"
              >
                Reactivate
              </button>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              placeholder="new password (8+)"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="off"
              className={`${inputCls} max-w-[14rem]`}
              maxLength={200}
            />
            <button
              type="button"
              onClick={() => void resetPw()}
              disabled={busy || newPw.length < 8}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:border-emerald-400 disabled:opacity-50"
            >
              Reset password
            </button>
          </div>
          {u.status === 'active' && (
            <div className="mt-3">
              <button type="button" onClick={() => void issueResetLink()} disabled={busy} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:border-emerald-400 disabled:opacity-50">
                {busy ? 'Creating…' : 'Create one-time reset link'}
              </button>
              {resetLink && <textarea readOnly value={resetLink} aria-label="One-time reset link" className={`${inputCls} mt-2 min-h-20 w-full text-xs`} onFocus={(e) => e.currentTarget.select()} />}
            </div>
          )}
          {error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>}
        </div>
      )}
    </li>
  )
}

export default function UsersAdmin({ users, staff, self }: { users: AppUserRow[]; staff: StaffOpt[]; self: string }) {
  const [invite, setInvite] = useState<{ username: string; displayName: string; role: string; staffId: string; link: string | null }>({ username: '', displayName: '', role: 'store', staffId: '', link: null })
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  async function issueInvite() {
    if (inviteBusy || invite.username.trim().length < 3 || invite.displayName.trim() === '') return
    setInviteBusy(true); setInviteError(null); setInvite((p) => ({ ...p, link: null }))
    try {
      const result = await issueRestaurantInvitationAction(invite)
      if (result.ok) { setInvite((p) => ({ ...p, link: `${window.location.origin}/invite?token=${encodeURIComponent(result.token)}` })); toast('Invitation created — copy the link to the person') }
      else setInviteError(result.error)
    } catch { setInviteError('Could not reach the server — no invitation was created.') }
    finally { setInviteBusy(false) }
  }
  return (
    <>
      <section className={`${cardCls} mt-4`}>
        <h2 className={sectionHeadCls}>Accounts</h2>
        <ul className="mt-1 divide-y divide-rule-soft">
          {users.map((u) => (
            <UserRow key={u.id} u={u} staff={staff} self={self} />
          ))}
        </ul>
      </section>
      <CreateUser staff={staff} />
      <section className={`${cardCls} mt-4`}>
        <h2 className={sectionHeadCls}>Invite someone</h2>
        <p className="mt-1 text-sm text-stone-600">Creates a 48-hour, one-use link. They choose their own password; the link is shown once.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <input aria-label="Username" placeholder="username" value={invite.username} onChange={(e) => setInvite((p) => ({ ...p, username: e.target.value }))} autoCapitalize="none" className={inputCls} maxLength={30} />
          <input aria-label="Display name" placeholder="display name" value={invite.displayName} onChange={(e) => setInvite((p) => ({ ...p, displayName: e.target.value }))} className={inputCls} maxLength={80} />
          <select aria-label="Role" value={invite.role} onChange={(e) => setInvite((p) => ({ ...p, role: e.target.value }))} className={selectCls}>{ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          <select aria-label="Staff link" value={invite.staffId} onChange={(e) => setInvite((p) => ({ ...p, staffId: e.target.value }))} className={selectCls}><option value="">No staff link</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select>
        </div>
        {inviteError && <p className="mt-2 text-sm font-medium text-red-700">{inviteError}</p>}
        <button type="button" onClick={() => void issueInvite()} disabled={inviteBusy || invite.username.trim().length < 3 || invite.displayName.trim() === ''} className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white disabled:bg-stone-300">{inviteBusy ? 'Creating…' : 'Create invitation link'}</button>
        {invite.link && <textarea readOnly value={invite.link} aria-label="Invitation link" className={`${inputCls} mt-2 min-h-20 w-full text-xs`} onFocus={(e) => e.currentTarget.select()} />}
      </section>
    </>
  )
}
