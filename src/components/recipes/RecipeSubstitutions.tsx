'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ComponentPicker from './ComponentPicker'
import { addRecipeSubstitution, deleteRecipeSubstitution } from '@/server/recipes-actions'
import type { ComponentHit } from '@/lib/types'
import { cardCls, inputCls, sectionHeadCls } from '@/components/ui'
import type { RecipeLineRow } from '@/lib/types'

type Row = { id: string; recipe_line_id: string; primary_name: string; substitute_code: string; substitute_name: string; unit: string; quantity_ratio: string; note: string | null }
export default function RecipeSubstitutions({ recipeId, lines, initial }: { recipeId: string; lines: RecipeLineRow[]; initial: Row[] }) {
  const router = useRouter(); const [lineId, setLineId] = useState(''); const [item, setItem] = useState<ComponentHit | null>(null); const [ratio, setRatio] = useState('1'); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  async function add() { if (!item || item.kind !== 'item' || !lineId) return; setBusy(true); setError(null); const r = await addRecipeSubstitution({ lineId, substituteItemId: item.id, ratio, note }); setBusy(false); if (!r.ok) setError(r.error); else { setItem(null); setNote(''); setRatio('1'); router.refresh() } }
  async function remove(id: string) { setBusy(true); const r = await deleteRecipeSubstitution(id); setBusy(false); if (!r.ok) setError(r.error); else router.refresh() }
  return <section className={cardCls}><h3 className={sectionHeadCls}>Approved substitutions</h3><p className="mt-1 text-sm text-stone-600">A substitute leaves the primary ingredient and recipe version intact. Ratio 1 means equal quantity.</p><div className="mt-3 grid gap-2 sm:grid-cols-4"><select aria-label="Primary ingredient" value={lineId} onChange={e => setLineId(e.target.value)} className={inputCls}><option value="">Ingredient line…</option>{lines.filter(l => l.component_item_id !== null).map(l => <option key={l.id} value={l.id}>{l.component_name}</option>)}</select><ComponentPicker excludeRecipeId={recipeId} value={item} onPick={setItem} onClear={() => setItem(null)} /><input aria-label="Substitution ratio" inputMode="decimal" value={ratio} onChange={e => setRatio(e.target.value)} className={inputCls} placeholder="Ratio"/><button type="button" disabled={busy || !lineId || item?.kind !== 'item'} onClick={() => void add()} className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-stone-300">Add alternative</button></div><input aria-label="Substitution note" value={note} onChange={e => setNote(e.target.value)} className={`${inputCls} mt-2`} placeholder="When to use it (optional)"/>{error && <p className="mt-2 text-sm text-red-700">{error}</p>}<ul className="mt-3 divide-y divide-rule-soft">{initial.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span><b>{r.primary_name}</b> → {r.substitute_code} · {r.substitute_name} · ×{r.quantity_ratio}{r.note && <span className="ml-2 text-stone-500">{r.note}</span>}</span><button type="button" disabled={busy} onClick={() => void remove(r.id)} className="text-red-700 underline">Remove</button></li>)}</ul></section>
}
