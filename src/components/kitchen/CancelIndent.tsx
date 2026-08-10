'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cancelIndent } from '@/server/kitchen-actions'
import { toast } from '@/components/Toasts'

export default function CancelIndent({ indentId }: { indentId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function onCancel() {
    if (busy) return
    setBusy(true)
    try {
      const res = await cancelIndent(indentId)
      if (res.ok) {
        toast('Indent cancelled — it stays on record')
        router.refresh()
      } else {
        toast(res.error, 'error')
      }
    } catch {
      toast('Could not reach the server — nothing was changed.', 'error')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-500 hover:border-red-300 hover:text-red-700"
      >
        Cancel indent
      </button>
    )
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-stone-500">The section no longer wants this?</span>
      <button
        type="button"
        onClick={() => void onCancel()}
        disabled={busy}
        className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
      >
        {busy ? '…' : 'Yes, cancel'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-lg border border-stone-200 px-2 py-1.5 text-sm text-stone-500 hover:border-stone-300"
      >
        Keep
      </button>
    </span>
  )
}
