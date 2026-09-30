'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPurchaseOrderFromQuote } from '@/server/quote-actions'

export default function QuoteToOrder({ id }: { id: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false)
  async function convert() { if (busy) return; setBusy(true); try { const result = await createPurchaseOrderFromQuote(id); if (result.ok) router.push(`/store/purchasing/orders/${result.id}`) } finally { setBusy(false) } }
  return <button type="button" disabled={busy} onClick={() => void convert()} className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-800">{busy ? 'Opening…' : 'Raise draft PO'}</button>
}
