'use client'

// “Photograph the menu”: copy today's live dish costs into
// dish_cost_snapshots. Live costs rewrite history — photographs don't.
// One photograph per day; month-end is the ritual.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { photographMenu } from '@/server/counts-actions'

export default function SnapshotButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onClick() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await photographMenu()
      if (res.ok) {
        setMsg({ ok: true, text: `Photographed ${res.dishes} ${res.dishes === 1 ? 'dish' : 'dishes'} at today's costs.` })
        router.refresh()
      } else {
        setMsg({ ok: false, text: res.error })
      }
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server — nothing was photographed.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:border-emerald-400 disabled:opacity-50"
      >
        {busy ? 'Photographing…' : '📸 Photograph the menu'}
      </button>
      {msg !== null && (
        <p className={`mt-1.5 text-xs font-medium ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>
      )}
    </div>
  )
}
