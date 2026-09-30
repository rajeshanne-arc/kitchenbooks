'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { reviewPosDifference } from '@/server/pos-reconciliation-actions'
export default function PosDifferenceReview({ importId, date, initialNote, status }: { importId: string; date: string; initialNote: string | null; status: string }) {
  const router = useRouter(); const [note, setNote] = useState(initialNote ?? ''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  async function save(next: 'acknowledged' | 'correction_requested') { setBusy(true); setError(null); const r = await reviewPosDifference({ importId, businessDate: date, status: next, note }); setBusy(false); if (!r.ok) setError(r.error); else router.refresh() }
  return <div className="mt-2 flex flex-wrap items-center justify-end gap-2"><input aria-label={`POS review note for ${date}`} value={note} onChange={e => setNote(e.target.value)} placeholder="Review note" className="rounded-lg border border-stone-300 px-2 py-1 text-xs"/><button type="button" disabled={busy || note.trim() === ''} onClick={() => void save('acknowledged')} className="text-xs font-semibold text-emerald-700 underline">Acknowledge</button><button type="button" disabled={busy || note.trim() === ''} onClick={() => void save('correction_requested')} className="text-xs font-semibold text-amber-700 underline">Request correction</button>{error && <span className="w-full text-xs text-red-700">{error}</span>}<span className="text-[10px] text-stone-400">{status.replace('_', ' ')}</span></div>
}
