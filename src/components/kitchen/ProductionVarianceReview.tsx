'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { reviewProductionVariance } from '@/server/production-variance-actions'
import type { ProductionVarianceRow } from '@/lib/types'
export default function ProductionVarianceReview({ row, monthStart }: { row: ProductionVarianceRow; monthStart: string }) {
  const router = useRouter(); const [note, setNote] = useState(row.review_note ?? ''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  async function save(status: 'acknowledged' | 'correction_requested') { setBusy(true); setError(null); const r = await reviewProductionVariance({ recipeId: row.recipe_id, monthStart, status, note }); setBusy(false); if (!r.ok) setError(r.error); else router.refresh() }
  return <div className="mt-2 flex flex-wrap items-center justify-end gap-2"><input aria-label={`Variance note for ${row.recipe_code}`} value={note} onChange={e => setNote(e.target.value)} placeholder="Review note" className="rounded-lg border border-stone-300 px-2 py-1 text-xs"/><button type="button" disabled={busy || note.trim() === ''} onClick={() => void save('acknowledged')} className="text-xs font-semibold text-emerald-700 underline">Acknowledge</button><button type="button" disabled={busy || note.trim() === ''} onClick={() => void save('correction_requested')} className="text-xs font-semibold text-amber-700 underline">Request correction</button>{error && <span className="w-full text-xs text-red-700">{error}</span>}</div>
}
