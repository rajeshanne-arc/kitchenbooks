'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { decidePurchaseQuote } from '@/server/quote-actions'

export default function QuoteDecision({ id }: { id: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false)
  async function decide(decision: 'accepted' | 'rejected') {
    if (busy) return; setBusy(true)
    try { const result = await decidePurchaseQuote(id, decision); if (result.ok) router.refresh() } finally { setBusy(false) }
  }
  return <span className="flex gap-1"><button type="button" disabled={busy} onClick={() => void decide('accepted')} className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-800">Accept</button><button type="button" disabled={busy} onClick={() => void decide('rejected')} className="rounded-lg border border-red-300 px-2 py-1 text-xs font-medium text-red-700">Reject</button></span>
}
