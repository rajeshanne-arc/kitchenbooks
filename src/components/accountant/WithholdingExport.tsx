'use client'

import { useState } from 'react'

export default function WithholdingExport({ today }: { today: string }) {
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const href = `/api/accounts/withholdings-export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  return <div className="flex flex-wrap items-end gap-2">
    <label className="text-xs text-stone-600"><span className="mb-1 block">From</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-xl border border-stone-300 px-2 py-2 text-sm" /></label>
    <label className="text-xs text-stone-600"><span className="mb-1 block">To</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-xl border border-stone-300 px-2 py-2 text-sm" /></label>
    <a href={from !== '' && to !== '' && from <= to ? href : undefined} aria-disabled={from === '' || to === '' || from > to} className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 aria-disabled:pointer-events-none aria-disabled:opacity-50">Export CSV</a>
  </div>
}
