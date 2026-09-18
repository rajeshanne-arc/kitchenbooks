'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPurchaseQuote } from '@/server/quote-actions'
import type { ItemHit, ItemHitExisting, VendorHit } from '@/lib/types'
import { inputCls, selectCls, btnCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'

type Line = { item: ItemHitExisting | null; qty: string; rate: string }

export default function QuoteForm({ vendors, today }: { vendors: VendorHit[]; today: string }) {
  const router = useRouter()
  const [vendorId, setVendorId] = useState('')
  const [date, setDate] = useState(today)
  const [valid, setValid] = useState('')
  const [reference, setReference] = useState('')
  const [lines, setLines] = useState<Line[]>([{ item: null, qty: '1', rate: '' }])
  const [suggestions, setSuggestions] = useState<Record<number, ItemHitExisting[]>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState(false)

  async function search(i: number, q: string) {
    setLines((ls) => ls.map((l, n) => n === i ? { ...l, item: l.item?.name.toLowerCase() === q.toLowerCase() ? l.item : null } : l))
    if (q.trim().length < 2) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(`/api/items/search?q=${encodeURIComponent(q)}`, { cache: 'no-store', signal: controller.signal })
      if (!response.ok) return
      const hits = (await response.json()) as ItemHit[]
      setSuggestions((s) => ({ ...s, [i]: hits.filter((h): h is ItemHitExisting => h.kind === 'item') }))
    } catch {
      // Keep the typed value visible when the optional search request fails.
    } finally {
      clearTimeout(timeout)
    }
  }

  async function save() {
    if (!vendorId || busy || lines.some((l) => l.item === null)) return
    setBusy(true)
    setError(null)
    try {
      const result = await createPurchaseQuote({ vendorId, quoteDate: date, validUntil: valid, reference, note: '', lines: lines.map((l) => ({ itemId: l.item!.id, qty: l.qty, rate: l.rate, note: '' })) })
      if (!result.ok) setError(result.error)
      else {
        setAck(true)
        setLines([{ item: null, qty: '1', rate: '' }])
        setReference('')
        router.refresh()
      }
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="font-display text-lg font-bold text-stone-900">Record a vendor quotation</h2>
      <p className="mt-1 text-sm text-stone-600">A quotation is evidence from the vendor. It does not create a purchase or move stock.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <select aria-label="Vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={selectCls}><option value="">Vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        <input aria-label="Quote date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls}/>
        <input aria-label="Valid until" type="date" value={valid} onChange={(e) => setValid(e.target.value)} className={inputCls}/>
      </div>
      <input aria-label="Reference" placeholder="Vendor reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} className={`${inputCls} mt-3`}/>
      <div className="mt-3 space-y-2">
        {lines.map((l, i) => <div key={i} className="grid grid-cols-[1fr_5rem_6rem_auto] gap-2">
          <input aria-label={`Item ${i + 1}`} list={`quote-items-${i}`} placeholder="Type item name" value={l.item?.name ?? ''} onChange={(e) => { const value = e.target.value; const exact = suggestions[i]?.find((h) => h.name === value || h.code === value) ?? null; setLines((ls) => ls.map((x, n) => n === i ? { ...x, item: exact } : x)); void search(i, value) }} className={inputCls}/>
          <datalist id={`quote-items-${i}`}>{(suggestions[i] ?? []).map((h) => <option key={h.id} value={h.name}>{h.code}</option>)}</datalist>
          <input aria-label={`Quantity ${i + 1}`} value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, n) => n === i ? { ...x, qty: e.target.value } : x))} className={inputCls}/>
          <input aria-label={`Rate ${i + 1}`} placeholder="rate" value={l.rate} onChange={(e) => setLines((ls) => ls.map((x, n) => n === i ? { ...x, rate: e.target.value } : x))} className={inputCls}/>
          <button type="button" aria-label="Remove line" onClick={() => setLines((ls) => ls.length === 1 ? ls : ls.filter((_, n) => n !== i))}>×</button>
        </div>)}
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className={btnCls} disabled={busy || !vendorId || lines.some((l) => l.item === null)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save quotation'}</button>
        <button type="button" className="rounded-xl border border-stone-300 px-3 py-2 text-sm" onClick={() => setLines((ls) => [...ls, { item: null, qty: '1', rate: '' }])}>Add line</button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {ack && <SaveAck headline="Quotation recorded" sub="The quotation is stored as vendor evidence; it did not move stock." onDismiss={() => setAck(false)} />}
    </section>
  )
}
