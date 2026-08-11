'use client'

// The day sheet. Marks save as INSERT-only rows; the latest row per person
// per day wins (attendance_current). A "corrected" marker appears when a
// day holds more than one row — tap it to see the full history, which is
// never hidden.

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { saveAttendance } from '@/server/labour-actions'
import type { AttendanceStatus, DaySheetRow } from '@/lib/types'
import { fmtDateTime } from '@/lib/format'
import { cardCls, numCls } from '@/components/ui'

const STATUSES: { value: AttendanceStatus; label: string; on: string }[] = [
  { value: 'present', label: 'P', on: 'border-emerald-700 bg-emerald-700 text-white' },
  { value: 'half', label: '½', on: 'border-amber-500 bg-amber-500 text-white' },
  { value: 'off', label: 'Off', on: 'border-stone-500 bg-stone-500 text-white' },
  { value: 'leave', label: 'L', on: 'border-sky-600 bg-sky-600 text-white' },
  { value: 'absent', label: 'A', on: 'border-red-600 bg-red-600 text-white' },
]

export default function AttendanceSheet({ date, initialSheet }: { date: string; initialSheet: DaySheetRow[] }) {
  const [sheet, setSheet] = useState(initialSheet)
  const [picks, setPicks] = useState<Record<string, AttendanceStatus>>({})
  const [openHistory, setOpenHistory] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const router = useRouter()
  const pathname = usePathname()

  const selectionFor = (row: DaySheetRow): AttendanceStatus | null => picks[row.staff_id] ?? row.effective
  const changes = sheet.filter((r) => {
    const pick = picks[r.staff_id]
    return pick !== undefined && pick !== r.effective
  })

  function markAllPresent() {
    setSavedNote(null)
    setPicks((prev) => {
      const next = { ...prev }
      for (const r of sheet) next[r.staff_id] = 'present'
      return next
    })
  }

  async function save() {
    if (changes.length === 0 || busy) return
    setBusy(true)
    setError(null)
    setSavedNote(null)
    try {
      const res = await saveAttendance({
        date,
        marks: changes.map((r) => ({ staffId: r.staff_id, status: picks[r.staff_id] })),
      })
      if (res.ok) {
        setSheet(res.sheet)
        setPicks({})
        setSavedNote(`Saved — ${res.inserted} ${res.inserted === 1 ? 'row' : 'rows'} added for ${date}.`)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 pb-28">
      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value !== '') router.push(`${pathname}?d=${e.target.value}` as never)
            }}
            className={`${numCls} w-44`}
          />
          <button
            type="button"
            onClick={markAllPresent}
            disabled={sheet.length === 0}
            className="rounded-xl border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-40"
          >
            Mark all present
          </button>
        </div>
        <p className="mt-2 text-xs text-stone-400">
          Present and off days are paid, half pays half; leave and absent don’t — the sheets’ assumption, kept.
          Contract staff appear here but never enter labour cost.
        </p>
      </section>

      {savedNote !== null && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-stone-800">
          {savedNote}
        </div>
      )}

      {sheet.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
          <p className="text-lg font-semibold text-stone-900">No active staff yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
            Add people on the Staff page first — then this sheet lists them in roster order every day.
          </p>
        </div>
      ) : (
        <section className={cardCls}>
          <ul className="divide-y divide-rule-soft">
            {sheet.map((r) => {
              const sel = selectionFor(r)
              const corrected = r.history.length > 1
              return (
                <li key={r.staff_id} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[15px] font-medium text-stone-900">{r.name}</span>
                        {corrected && (
                          <button
                            type="button"
                            onClick={() => setOpenHistory(openHistory === r.staff_id ? null : r.staff_id)}
                            className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700"
                          >
                            corrected ×{r.history.length}
                          </button>
                        )}
                      </div>
                      <div className="text-xs text-stone-500">
                        <span className="font-mono">{r.code}</span>
                        {r.designation !== null && <> · {r.designation}</>}
                        {r.section_name !== null && <> · {r.section_name}</>}
                        {r.employment_type === 'contract' && <span className="text-stone-400"> · contract</span>}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {STATUSES.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => {
                            setSavedNote(null)
                            setPicks((p) => ({ ...p, [r.staff_id]: s.value }))
                          }}
                          aria-label={`${r.name}: ${s.value}`}
                          className={`min-w-9 rounded-lg border px-2 py-1.5 text-sm font-semibold ${
                            sel === s.value ? s.on : 'border-stone-200 bg-white text-stone-500 hover:border-stone-400'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {openHistory === r.staff_id && (
                    <ul className="mt-2 space-y-1 rounded-lg border border-stone-200 bg-stone-50 p-2.5 text-xs text-stone-600">
                      {r.history.map((h, i) => (
                        <li key={i} className="flex items-center justify-between gap-3">
                          <span className="font-medium">{h.status}</span>
                          <span>
                            {fmtDateTime(h.created_at)}
                            {i === 0 && <span className="ml-1.5 font-semibold text-emerald-700">· effective</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {sheet.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <span className="text-sm text-stone-500">
              {changes.length === 0 ? 'No unsaved marks' : `${changes.length} to save`}
            </span>
            <button
              type="button"
              onClick={save}
              disabled={changes.length === 0 || busy}
              className="rounded-xl bg-emerald-700 px-6 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {busy ? 'Saving…' : 'Save attendance'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
