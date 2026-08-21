'use client'

// Editing a request that nobody has answered yet.
//
// The rule this screen keeps: a record is editable only while it asserts an
// INTENTION and nothing depends on it yet. An indent is a request — until an
// issue carries its id, changing it edits a description of what the kitchen
// wants. `editable` is decided on the SERVER and re-checked inside the save
// transaction; this component only draws what it was told.
//
// The ITEM on an existing line is fixed: there is no UPDATE grant on
// indent_lines.item_id, so asking for a different item is removing a line and
// adding one — which is also the truer story of what happened.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IndentLineRow, IndentRow, IssuableItemHit, Section } from '@/lib/types'
import { updateIndent } from '@/server/kitchen-actions'
import { parseQty } from '@/lib/money'
import {
  btnCls,
  btnGhostCls,
  cardCls,
  codeCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
} from '@/components/ui'
import IssueItemPicker from '@/components/store/IssueItemPicker'
import { toast } from '@/components/Toasts'
import SaveAck from '@/components/SaveAck'

/** an existing line carries the item it was raised for; a new one gets it
 *  from the same picker the create form uses, and keeps the whole hit so the
 *  picker can draw its own chip (on-hand and all) */
type PickedItem = { id: string; code: string; name: string; unit: string }
type EditLine = {
  key: number
  lineId: string | null
  item: PickedItem | null
  hit: IssuableItemHit | null
  qty: string
}

const cleanQty = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function IndentEdit({
  indent,
  lines,
  sections,
  sessions,
}: {
  indent: IndentRow
  lines: IndentLineRow[]
  sections: Section[]
  /** the `session` list — an indent is for a SHIFT, not a day */
  sessions: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)
  const [date, setDate] = useState(indent.indent_date)
  const [sectionId, setSectionId] = useState(indent.section_id)
  const [session, setSession] = useState(indent.session)
  const [note, setNote] = useState(indent.note ?? '')
  const [rows, setRows] = useState<EditLine[]>([])
  const [nextKey, setNextKey] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed from the props AT THE MOMENT OF OPENING. useState only runs on
  // mount, and this component survives the soft navigation a refresh does —
  // so a form opened after a save would otherwise show the old request.
  function openEditor() {
    setDate(indent.indent_date)
    setSectionId(indent.section_id)
    setSession(indent.session)
    setNote(indent.note ?? '')
    setRows(
      lines.map((l, i) => ({
        key: i + 1,
        lineId: l.id,
        item: { id: l.item_id, code: l.item_code, name: l.item_name, unit: l.purchase_unit },
        hit: null,
        qty: l.qty_requested,
      })),
    )
    setNextKey(lines.length + 1)
    setError(null)
    setOpen(true)
  }

  const patch = (key: number, p: Partial<EditLine>) =>
    setRows((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const addLine = () => {
    setRows((ls) => [...ls, { key: nextKey, lineId: null, item: null, hit: null, qty: '' }])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) => setRows((ls) => ls.filter((l) => l.key !== key))

  const ready = (l: EditLine) => l.item !== null && parseQty(l.qty) !== null && Number(l.qty) > 0
  const itemIds = rows.flatMap((l) => (l.item === null ? [] : [l.item.id]))
  const duplicated = new Set(itemIds).size !== itemIds.length
  const canSave =
    !saving && sectionId !== '' && session !== '' && rows.length > 0 && rows.every(ready) && !duplicated

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await updateIndent({
        indentId: indent.id,
        indentDate: date,
        session,
        sectionId,
        note: note.trim(),
        lines: rows.map((l) => ({
          id: l.lineId,
          itemId: (l.item as PickedItem).id,
          qty: l.qty.trim(),
        })),
      })
      if (res.ok) {
        setOpen(false)
        setAck({ headline: 'Request updated — the store sees the new list', sub: 'Editable only while it is open and nothing has been issued against it. The moment an issue stamps it, the asked-versus-given gap acquires meaning and this freezes.' })
        toast('Request updated — the store sees the new list')
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was changed. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={openEditor} className={btnGhostCls}>
        Edit this request
      </button>
    )
  }

  return (
    <section className={cardCls}>
      {ack !== null && (
        <div className="mb-3">
          <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Edit the request</h2>
        <span className="text-xs text-stone-500">nobody has issued against it yet</span>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-[11rem_1fr]">
        <label className="block">
          <span className={fieldLabelCls}>Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`${numCls} w-full`}
          />
        </label>
        <div>
          <span className={fieldLabelCls}>Department</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={sectionId === s.id}
                onClick={() => setSectionId(s.id)}
                className={`min-h-10 rounded-xl border px-2 py-2 text-sm font-medium ${
                  sectionId === s.id
                    ? 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <span className={fieldLabelCls}>Session</span>
        {sessions.length === 0 ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No sessions are set up — add them in Settings → Lists.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sessions.map((sn) => (
              <button
                key={sn}
                type="button"
                aria-pressed={session === sn}
                onClick={() => setSession(sn)}
                className={`min-h-10 rounded-full border px-3.5 py-2 text-sm font-medium ${
                  session === sn
                    ? 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
                }`}
              >
                {sn}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 divide-y divide-rule-soft border-t border-rule-soft">
        {rows.map((line, i) => (
          <div key={line.key} className="space-y-2 py-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {line.lineId !== null && line.item !== null ? (
                  <div className="flex items-center gap-2 rounded-lg border border-rule bg-stone-50 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[15px] text-stone-900">{line.item.name}</span>
                    <span className={codeCls}>{line.item.code}</span>
                  </div>
                ) : (
                  <IssueItemPicker
                    value={line.hit}
                    onPick={(hit) =>
                      patch(line.key, {
                        hit,
                        item: { id: hit.id, code: hit.code, name: hit.name, unit: hit.purchase_unit },
                      })
                    }
                    onClear={() => patch(line.key, { hit: null, item: null })}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                aria-label={`Remove line ${i + 1}`}
                className="mt-1 shrink-0 rounded-md px-2 py-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-700"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                inputMode="decimal"
                placeholder="Qty"
                aria-label={`Quantity, line ${i + 1}`}
                value={line.qty}
                onChange={(e) => patch(line.key, { qty: cleanQty(e.target.value) })}
                className={`${numCls} w-24`}
              />
              {line.item !== null && <span className="text-sm text-stone-500">{line.item.unit}</span>}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="py-3 text-sm text-stone-500">
            No lines left. A request with nothing in it is a cancelled request — add a line, or close this
            and cancel it instead.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={addLine}
        className="mt-3 w-full rounded-xl border border-dashed border-stone-300 py-2.5 text-sm font-medium text-stone-500 hover:border-emerald-400 hover:text-emerald-700"
      >
        ＋ Add an item
      </button>

      <label className="mt-3 block">
        <span className={fieldLabelCls}>Note</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="optional"
          className={inputCls}
          maxLength={300}
        />
      </label>

      {duplicated && (
        <p className="mt-3 text-sm text-amber-800">
          The same item is on two lines — combine the quantities.
        </p>
      )}

      {error !== null && (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void onSave()} disabled={!canSave} className={btnCls}>
          {saving ? 'Saving…' : 'Save the request'}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={saving} className={btnGhostCls}>
          Discard changes
        </button>
      </div>
      <p className="mt-3 text-xs text-stone-500">
        Editing is possible only because nothing has been issued yet. Once the store answers, what was
        asked is half of a comparison and stops being editable.
      </p>
    </section>
  )
}
