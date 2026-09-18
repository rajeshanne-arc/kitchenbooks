'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addMembershipAction } from '@/server/auth-actions'
import { ALL_ROLES } from '@/lib/roles'
import type { StaffRow } from '@/lib/types'
import { fieldLabelCls, inputCls, selectCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function AddMembershipForm({ staff }: { staff: Pick<StaffRow, 'id' | 'code' | 'name'>[] }) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('store')
  const [staffId, setStaffId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (busy || username.trim().length < 3) return
    setBusy(true)
    setError(null)
    try {
      const result = await addMembershipAction({ username, role, staffId })
      if (result.ok) {
        toast(`Access added for ${username.trim().toLowerCase()}`)
        setUsername('')
        setStaffId('')
        router.refresh()
      } else setError(result.error)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="font-display text-lg font-bold text-stone-900">Add access from another restaurant</h2>
      <p className="mt-1 text-sm text-stone-600">Enter an existing global username. This does not create or reset an account.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelCls}>Existing username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" className={inputCls} maxLength={60} />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Restaurant role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={selectCls}>
            {ALL_ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="col-span-2 block">
          <span className={fieldLabelCls}>Staff link (optional)</span>
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={selectCls}>
            <option value="">—</option>
            {staff.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>}
      <button type="button" onClick={() => void save()} disabled={busy || username.trim().length < 3} className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300">
        {busy ? 'Adding…' : 'Add restaurant access'}
      </button>
    </section>
  )
}
