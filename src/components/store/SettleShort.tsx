'use client'

// Chasing a short is the whole value of recording one. This is the only
// UPDATE the table allows — settlement, credit note number, note — and it
// exists so the day the credit note arrives, it lands on the record that was
// waiting for it rather than in somebody's messages.
//
// What was short, and against which line, can never be rewritten here.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { settleShort } from '@/server/shorts-actions'
import { toast } from '@/components/Toasts'
import { SHORT_SETTLEMENTS, SHORT_SETTLEMENT_LABELS } from '@/components/store/shorts'
import { btnCls, btnGhostCls, fieldLabelCls, inputCls, selectCls } from '@/components/ui'
import type { ShortSettlement } from '@/lib/types'

export default function SettleShort({
  id,
  settlement,
  creditNoteRef,
  note,
  label,
}: {
  id: string
  settlement: ShortSettlement
  creditNoteRef: string | null
  note: string | null
  /** 'Chase it…' while open, 'Amend' once it is settled */
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    settlement,
    creditNoteRef: creditNoteRef ?? '',
    note: note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await settleShort({
        id,
        settlement: form.settlement,
        creditNoteRef: form.creditNoteRef,
        note: form.note,
      })
      if (res.ok) {
        toast(`${SHORT_SETTLEMENT_LABELS[settlement] ?? settlement} — the short is no longer open`, 'ok')
        setOpen(false)
        router.refresh()
      } else {
        setError(res.error)
        toast(res.error, 'error')
      }
    } catch {
      setError('Could not reach the server — nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-rule px-2.5 py-1 text-[13px] font-medium text-stone-600 hover:border-stone-400 hover:bg-stone-50"
      >
        {label}
      </button>
    )
  }

  return (
    <div className="mt-1 text-left">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <label className={fieldLabelCls} htmlFor={`settle-${id}`}>
            Where it stands
          </label>
          <select
            id={`settle-${id}`}
            value={form.settlement}
            onChange={(e) => setForm((f) => ({ ...f, settlement: e.target.value as ShortSettlement }))}
            className={selectCls}
          >
            {SHORT_SETTLEMENTS.map((s) => (
              <option key={s} value={s}>
                {SHORT_SETTLEMENT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {form.settlement === 'credit_note' && (
          <div className="w-44">
            <label className={fieldLabelCls} htmlFor={`cn-${id}`}>
              Credit note no.
            </label>
            <input
              id={`cn-${id}`}
              autoComplete="off"
              value={form.creditNoteRef}
              onChange={(e) => setForm((f) => ({ ...f, creditNoteRef: e.target.value }))}
              className={inputCls}
            />
          </div>
        )}
        <div className="min-w-[12rem] flex-1">
          <label className={fieldLabelCls} htmlFor={`note-${id}`}>
            Note (optional)
          </label>
          <input
            id={`note-${id}`}
            autoComplete="off"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            className={inputCls}
          />
        </div>
      </div>
      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" disabled={busy} onClick={submit} className={btnCls}>
          {busy ? 'Saving…' : 'Save where it stands'}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className={btnGhostCls}>
          Cancel
        </button>
      </div>
    </div>
  )
}
