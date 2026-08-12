'use client'

// Goods going back to the vendor. The kitchen→store return already existed;
// this is the other direction, and the thing it exists for is the CREDIT: bad
// goods leave and the money has to be chased.
//
// The RATE is typed, not looked up. It is what the credit is CLAIMED at —
// normally the rate on the bill the goods arrived on, but a vendor does not
// always credit at the price they charged, and filling it in silently would
// make the app state a claim nobody made.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IssuableItemHit, VendorReturnInput, VendorSel } from '@/lib/types'
import { saveVendorReturn } from '@/server/vendor-return-actions'
import { formatMicro, lineValueMicro, parseMoney, parseQty, sumMicro } from '@/lib/money'
import { todayLocal } from '@/lib/format'
import { toast } from '@/components/Toasts'
import VendorPicker from '@/components/VendorPicker'
import IssueItemPicker from '@/components/store/IssueItemPicker'
import {
  btnCls,
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  thCls,
  thNumCls,
} from '@/components/ui'

type Line = { key: number; item: IssuableItemHit | null; qty: string; rate: string }
const newLine = (key: number): Line => ({ key, item: null, qty: '', rate: '' })

/** digits and at most one dot — the same keypad discipline as every other
 *  quantity field in the app */
const cleanNum = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function VendorReturnEntry() {
  const router = useRouter()
  const [returnDate, setReturnDate] = useState(todayLocal)
  const [vendor, setVendor] = useState<VendorSel | null>(null)
  // A vendor cannot be born on a return the way one is born on a bill: the
  // goods came from somebody already on file. Typing a new name is answered
  // with where vendors are actually created, not with a silent no-op.
  const [newVendorName, setNewVendorName] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [creditNoteRef, setCreditNoteRef] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patchLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }
  const removeLine = (key: number) => {
    if (lines.length === 1) {
      setLines([newLine(nextKey)])
      setNextKey((k) => k + 1)
    } else {
      setLines((ls) => ls.filter((l) => l.key !== key))
    }
  }

  const lineMicro = (l: Line) => {
    const q = parseQty(l.qty)
    const r = parseMoney(l.rate)
    return l.item !== null && q !== null && q > 0 && r !== null && r > 0 ? lineValueMicro(q, r) : null
  }
  const totalMicro = sumMicro(lines.map((l) => lineMicro(l) ?? 0n))

  const vendorId = vendor?.kind === 'existing' ? vendor.hit.id : null
  const canSave =
    !saving && vendorId !== null && reason.trim() !== '' && lines.every((l) => lineMicro(l) !== null)

  async function onSave() {
    if (!canSave || vendorId === null) return
    setSaving(true)
    setError(null)
    const payload: VendorReturnInput = {
      date: returnDate,
      vendorId,
      reason: reason.trim(),
      creditNoteRef: creditNoteRef.trim(),
      note: note.trim(),
      lines: lines.map((l) => ({
        itemId: (l.item as IssuableItemHit).id,
        qty: l.qty.trim(),
        rate: l.rate.trim(),
      })),
    }
    try {
      const res = await saveVendorReturn(payload)
      if (res.ok) {
        toast('Return recorded — it is now waiting on a credit note')
        setVendor(null)
        setNewVendorName(null)
        setReason('')
        setCreditNoteRef('')
        setNote('')
        setLines([newLine(nextKey)])
        setNextKey((k) => k + 1)
        setReturnDate(todayLocal())
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the return was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
          <label className="block">
            <span className={fieldLabelCls}>Date it went back</span>
            <input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className={`${numCls} w-full`}
            />
          </label>
          <div>
            <span className={fieldLabelCls}>Vendor</span>
            <VendorPicker
              /* the new-vendor branch is refused below before it can render,
                 so its category list is never read */
              categories={[]}
              value={vendor}
              onChange={(v) => {
                if (v?.kind === 'new') {
                  setNewVendorName(v.name)
                  return
                }
                setNewVendorName(null)
                setVendor(v)
              }}
            />
            {newVendorName !== null && (
              <p className="mt-1.5 text-xs text-amber-900">
                “{newVendorName}” is not on file. Goods can only go back to a vendor who sent them — add the
                vendor under Masters → Vendors, or enter the bill first.
              </p>
            )}
          </div>
        </div>

        <label className="mt-4 block">
          <span className={fieldLabelCls}>Why are they going back?</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="Rotten on arrival · wrong item · short weight"
            className={inputCls}
          />
        </label>
      </section>

      {/* A TABLE, on the shared column vocabulary: item, quantity, rate and
          what that adds up to, read down a column rather than hunted for in
          a stack of cards. */}
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>What is going back</h2>
        <div className="mt-2 overflow-x-auto">
          <table className={dataTableCls}>
            <thead>
              <tr>
                <th className={`${thCls} w-[36%]`}>Item</th>
                <th className={`${thNumCls} w-[6.5rem]`}>Qty</th>
                <th className={`${thCls} w-[5rem]`}>Unit</th>
                <th className={`${thNumCls} w-[7rem]`}>Rate</th>
                <th className={`${thNumCls} w-[7.5rem]`}>Credit</th>
                <th className={`${thCls} w-8`}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const micro = lineMicro(line)
                return (
                  <tr key={line.key} className="h-12 align-middle">
                    <td className="border-b border-rule-soft px-1 py-1.5">
                      <IssueItemPicker
                        value={line.item}
                        onPick={(hit) => patchLine(line.key, { item: hit })}
                        onClear={() => patchLine(line.key, { item: null })}
                      />
                    </td>
                    <td className="border-b border-rule-soft px-1 py-1.5">
                      <input
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`Quantity, line ${i + 1}`}
                        value={line.qty}
                        onChange={(e) => patchLine(line.key, { qty: cleanNum(e.target.value) })}
                        className={`${numCls} w-full text-right font-mono tabular-nums`}
                      />
                    </td>
                    <td className="border-b border-rule-soft px-2 py-1.5 text-sm text-stone-500">
                      {line.item?.unit_name ?? '—'}
                    </td>
                    <td className="border-b border-rule-soft px-1 py-1.5">
                      <input
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label={`Rate claimed, line ${i + 1}`}
                        value={line.rate}
                        onChange={(e) => patchLine(line.key, { rate: cleanNum(e.target.value) })}
                        className={`${numCls} w-full text-right font-mono tabular-nums`}
                      />
                    </td>
                    <td className="border-b border-rule-soft px-2 py-1.5 text-right font-mono text-sm font-semibold tabular-nums text-stone-900">
                      {micro !== null ? formatMicro(micro) : <span className="font-normal text-stone-300">—</span>}
                    </td>
                    <td className="border-b border-rule-soft px-1 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        aria-label={`Remove line ${i + 1}`}
                        className="rounded-md p-1 text-stone-300 hover:bg-stone-100 hover:text-stone-600"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-3 w-full rounded-xl border border-dashed border-stone-300 py-2.5 text-sm font-medium text-stone-500 hover:border-emerald-400 hover:text-emerald-700"
        >
          ＋ Add item
        </button>
        <div className="mt-3 flex items-center justify-between border-t border-rule pt-3">
          <span className="text-sm font-medium text-stone-500">Credit claimed</span>
          <span className="font-mono text-2xl font-bold tabular-nums text-stone-900">
            {formatMicro(totalMicro)}
          </span>
        </div>
        <p className="mt-1 text-xs text-stone-500">
          The rate is what the credit is claimed at — normally the rate on the bill these arrived on. It comes
          off what we owe this vendor as soon as it is saved.
        </p>
      </section>

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Paperwork</h2>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabelCls}>Credit note number, if they gave one already</span>
            <input
              value={creditNoteRef}
              onChange={(e) => setCreditNoteRef(e.target.value)}
              maxLength={120}
              placeholder="usually arrives later — leave blank"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Note</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder="optional"
              className={inputCls}
            />
          </label>
        </div>
      </section>

      {error !== null && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button type="button" onClick={onSave} disabled={!canSave} className={`w-full ${btnCls}`}>
        {saving ? 'Saving…' : 'Record the return'}
      </button>
    </div>
  )
}
