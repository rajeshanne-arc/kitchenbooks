'use client'

// Recent productions with void-by-reversal — the negative twin copies
// unit_cost EXACTLY; a recipe cost change between entry and void can never
// leave a residue.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProductionRow } from '@/lib/types'
import { voidProduction } from '@/server/kitchen-actions'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function ProductionList({ rows }: { rows: ProductionRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function onVoid(id: string) {
    if (busy !== null) return
    setBusy(id)
    try {
      const res = await voidProduction(id)
      if (res.ok) {
        toast(`Voided — ${formatMoneyString(res.reversal.value)} reversed`)
        router.refresh()
      } else {
        toast(res.error, 'error')
      }
    } catch {
      toast('Could not reach the server — nothing was voided.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Recent productions</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">Nothing recorded yet. A batch of gravy or dough goes here.</p>
      ) : (
        <ul className="mt-1 divide-y divide-rule-soft">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] text-stone-900">{r.recipe_name}</span>
                  {r.is_reversal && (
                    <span className="rounded-full border border-stone-300 bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-600">
                      reversal
                    </span>
                  )}
                  {r.is_voided && (
                    <span className="rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                      voided
                    </span>
                  )}
                </span>
                <span className="block text-xs text-stone-500">
                  {fmtDate(r.prod_date)} · {r.section_code} · {r.output_qty} {r.output_unit}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-sm font-semibold text-stone-900">{formatMoneyString(r.value)}</span>
                {!r.is_reversal && !r.is_voided && (
                  <button
                    type="button"
                    onClick={() => void onVoid(r.id)}
                    disabled={busy !== null}
                    className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-500 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                  >
                    {busy === r.id ? '…' : 'Void'}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
