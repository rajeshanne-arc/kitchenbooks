'use client'

// Recent kitchen wastage with void-by-reversal — the negative twin copies
// value and qty exactly; history is never edited.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { KitchenWastageRow } from '@/lib/types'
import { voidKitchenWastage } from '@/server/kitchen-actions'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function KitchenWastageList({ rows }: { rows: KitchenWastageRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function onVoid(id: string) {
    if (busy !== null) return
    setBusy(id)
    try {
      const res = await voidKitchenWastage(id)
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
      <h2 className={sectionHeadCls}>Recent kitchen wastage</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">Nothing yet. May it stay that way.</p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100">
          {rows.map((w) => (
            <li key={w.id} className={`flex items-center justify-between gap-3 py-2 ${w.is_reversal ? 'opacity-60' : ''}`}>
              <span className="min-w-0">
                <span className="block truncate text-sm text-stone-900">
                  {w.section_code} · {w.reason}
                  {w.item_name !== null && (
                    <span className="text-stone-500">
                      {' '}
                      · {w.qty} {w.purchase_unit} {w.item_name}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-stone-500">
                  {fmtDate(w.waste_date)}
                  {w.is_reversal && ' · reversal'}
                  {w.is_voided && (
                    <span className="ml-1.5 rounded-full border border-stone-300 bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-600">
                      voided
                    </span>
                  )}
                  {w.entered_by !== null && <> · by {w.entered_by}</>}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`text-sm font-semibold tabular-nums ${Number(w.value) < 0 ? 'text-stone-400' : 'text-red-700'}`}>
                  {formatMoneyString(w.value)}
                </span>
                {!w.is_reversal && !w.is_voided && (
                  <button
                    type="button"
                    onClick={() => void onVoid(w.id)}
                    disabled={busy !== null}
                    className="rounded-lg border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:border-red-400 hover:text-red-700 disabled:opacity-50"
                  >
                    {busy === w.id ? '…' : 'Void'}
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
