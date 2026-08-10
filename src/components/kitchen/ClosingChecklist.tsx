'use client'

// The chef's closing ritual: every kitchen section on one screen, a value
// box against each. VALUE, never item quantities — onions became gravy;
// value survives transformation, quantity does not. Saving over a saved
// section re-files it: the new row wins and wears the corrected marker.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ClosingChecklistRow } from '@/lib/types'
import { saveClosing } from '@/server/kitchen-actions'
import { formatMoneyString, parseMoney } from '@/lib/money'
import { cardCls, fieldLabelCls, numCls } from '@/components/ui'
import { toast } from '@/components/Toasts'
import { useLang } from '@/components/useLang'

export default function ClosingChecklist({ date, rows }: { date: string; rows: ClosingChecklistRow[] }) {
  const router = useRouter()
  const { label } = useLang()
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function save(sectionId: string) {
    const v = (values[sectionId] ?? '').trim()
    if (parseMoney(v) === null || busy !== null) return
    setBusy(sectionId)
    setErrors((e) => ({ ...e, [sectionId]: '' }))
    try {
      const res = await saveClosing({ date, sectionId, value: v, note: '' })
      if (res.ok) {
        setValues((s) => ({ ...s, [sectionId]: '' }))
        toast(
          `${res.closing.section_code} closed at ${formatMoneyString(res.closing.closing_value)}${
            res.closing.filings > 1 ? ` (corrected ×${res.closing.filings - 1})` : ''
          }`,
        )
        router.refresh()
      } else {
        setErrors((e) => ({ ...e, [sectionId]: res.error }))
      }
    } catch {
      setErrors((e) => ({ ...e, [sectionId]: 'Could not reach the server — nothing was saved.' }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">{label('closing_title')}</h2>
        <span className="text-xs text-stone-400">latest per section wins · kitchen_closing_current</span>
      </div>
      <p className="mt-1 text-xs text-stone-400">
        The rupee value each section still holds — prepped, half-cooked, everything. Type it again to correct;
        the new value wins and the correction stays visible.
      </p>
      <ul className="mt-2 divide-y divide-stone-100">
        {rows.map((r) => {
          const v = values[r.section_id] ?? ''
          const valid = parseMoney(v.trim()) !== null
          return (
            <li key={r.section_id} className="py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-[11px] text-stone-400">{r.code}</span>
                  <span className="truncate text-[15px] text-stone-900">{r.name}</span>
                  {r.closing_value !== null ? (
                    <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                      {formatMoneyString(r.closing_value)}
                      {r.filings > 1 && ` · corrected ×${r.filings - 1}`}
                    </span>
                  ) : (
                    <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[11px] text-stone-400">
                      {label('not_closed')}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={v}
                    onChange={(e) =>
                      setValues((s) => ({ ...s, [r.section_id]: e.target.value.replace(/[^\d.]/g, '') }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void save(r.section_id)
                    }}
                    className={`${numCls} w-24 text-right`}
                  />
                  <button
                    type="button"
                    onClick={() => void save(r.section_id)}
                    disabled={!valid || busy !== null}
                    className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                  >
                    {busy === r.section_id ? '…' : r.closing_value !== null ? label('refile') : label('save')}
                  </button>
                </span>
              </div>
              {errors[r.section_id] && (
                <p className="mt-1 text-xs font-medium text-red-700">{errors[r.section_id]}</p>
              )}
            </li>
          )
        })}
      </ul>
      <p className={`${fieldLabelCls} mt-2`}>Zero is a real closing — an empty section is information.</p>
    </section>
  )
}
