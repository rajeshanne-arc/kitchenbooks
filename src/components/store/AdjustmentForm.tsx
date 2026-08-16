'use client'

// A correction with no count behind it: opening stock, a unit error caught
// on the shelf, spoilage found in a corner.
//
// The direction is two buttons, not a minus sign. A signed quantity typed on
// a phone is a fat finger away from meaning the opposite of what was meant,
// and "onto the book" / "off the book" is the sentence the person is
// actually thinking. The form composes the sign; the server stores it.
//
// No rate field, deliberately: unit_cost is snapshotted server-side from
// item_costs, exactly as on an issue. The store never types a cost.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IssuableItemHit } from '@/lib/types'
import { saveAdjustment } from '@/server/adjustment-actions'
import { toast } from '@/components/Toasts'
import { parseQty } from '@/lib/money'
import IssueItemPicker from '@/components/store/IssueItemPicker'
import { btnCls, cardCls, fieldLabelCls, inputCls, numCls, sectionHeadCls, selectCls } from '@/components/ui'
import { useBusinessToday } from '@/components/BusinessDay'

const OTHER = '__other__'

export default function AdjustmentForm({ reasons }: { reasons: string[] }) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const [date, setDate] = useState(businessToday)
  const [item, setItem] = useState<IssuableItemHit | null>(null)
  const [direction, setDirection] = useState<'onto' | 'off'>('onto')
  const [qty, setQty] = useState('')
  const [picked, setPicked] = useState(reasons.length === 0 ? OTHER : '')
  const [typedReason, setTypedReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reason = picked === OTHER ? typedReason.trim() : picked
  const qtyParsed = parseQty(qty.trim())
  const canSave = !saving && item !== null && qtyParsed !== null && qtyParsed > 0 && reason !== ''

  async function onSave() {
    if (!canSave || item === null) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveAdjustment({
        date,
        itemId: item.id,
        qty: direction === 'off' ? `-${qty.trim()}` : qty.trim(),
        reason,
        note: note.trim(),
      })
      if (res.ok) {
        toast(`Book corrected — ${item.name} ${direction === 'off' ? 'off' : 'onto'} the book`)
        setItem(null)
        setQty('')
        setNote('')
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was corrected. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Correct the book</h2>
      <p className="mt-1.5 text-sm text-stone-500">
        One item, one difference, one reason. The cost is taken from what the item has been costing — it is never
        typed here.
      </p>

      <div className="mt-3 space-y-3">
        {/* The direction sits above everything it changes, in the shelf's
            own words — the same shape as the issue form's out/back. */}
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Direction of the correction">
          {(
            [
              { key: 'onto', title: 'Onto the book', sub: 'the shelf holds more' },
              { key: 'off', title: 'Off the book', sub: 'the shelf holds less' },
            ] as const
          ).map((d) => (
            <button
              key={d.key}
              type="button"
              aria-pressed={direction === d.key}
              onClick={() => setDirection(d.key)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                direction === d.key
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
              }`}
            >
              <span className="block text-[15px] font-semibold">{d.title}</span>
              <span className={`block text-xs ${direction === d.key ? 'text-emerald-100' : 'text-stone-500'}`}>
                {d.sub}
              </span>
            </button>
          ))}
        </div>

        <label className="block">
          <span className={fieldLabelCls}>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${numCls} w-full`} />
        </label>

        <div className="block">
          <span className={fieldLabelCls}>Item</span>
          <IssueItemPicker value={item} onPick={setItem} onClear={() => setItem(null)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Difference{item !== null && <> ({item.purchase_unit})</>}</span>
            <input
              inputMode="decimal"
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${numCls} w-full text-right`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Reason</span>
            <select value={picked} onChange={(e) => setPicked(e.target.value)} className={selectCls}>
              <option value="">—</option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              <option value={OTHER}>Something else…</option>
            </select>
          </label>
        </div>

        {picked === OTHER && (
          <label className="block">
            <span className={fieldLabelCls}>Say why</span>
            <input
              value={typedReason}
              onChange={(e) => setTypedReason(e.target.value)}
              placeholder="a few words — an owner decides later whether it joins the list"
              className={inputCls}
              maxLength={60}
            />
          </label>
        )}

        <label className="block">
          <span className={fieldLabelCls}>Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional — what happened"
            className={inputCls}
            maxLength={300}
          />
        </label>

        {item !== null && qtyParsed !== null && qtyParsed > 0 && (
          <p className="text-sm text-stone-600">
            {direction === 'onto' ? (
              <>
                Adds {qty.trim()} {item.purchase_unit} of {item.name} to the book. The book says{' '}
                {item.on_hand_qty} {item.purchase_unit} today — it is being told the shelf holds more than that.
              </>
            ) : (
              <>
                Takes {qty.trim()} {item.purchase_unit} of {item.name} off the book. The book says{' '}
                {item.on_hand_qty} {item.purchase_unit} today — it is being told that much is not on the shelf.
              </>
            )}
          </p>
        )}

        {error !== null && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <button type="button" onClick={onSave} disabled={!canSave} className={`${btnCls} w-full`}>
          {saving ? 'Correcting…' : 'Correct the book'}
        </button>
      </div>
    </section>
  )
}
