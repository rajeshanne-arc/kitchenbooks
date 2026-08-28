'use client'

// THE DRAFT EDITOR. Editable while it is a draft, and the server refuses it
// afterwards — the freeze is not a disabled button, it is a rule checked
// inside the transaction. This form only avoids offering what would be
// refused.
//
// QUANTITIES DEFAULT TO PAR MINUS ON HAND and rates to what THIS vendor last
// charged. Both are offers: they land in editable fields and nothing is
// written until Save. A rate this vendor has never given is left BLANK rather
// than borrowed from another vendor — measured, RR Chicken bills boneless at
// ₹330 and Sneha at ₹300, so a borrowed rate is wrong by ten per cent on a
// field somebody tabs past.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPurchaseOrder, updatePurchaseOrder } from '@/server/po-actions'
import { formatMoneyString, decimalStringToPaise, parseMoney, parseQty } from '@/lib/money'
import type { PoDraftLine, PoLineRow } from '@/lib/types'
import SaveAck from '@/components/SaveAck'
import Honesty from '@/components/Honesty'
import {
  btnCls,
  btnGhostCls,
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

type Line = { key: number; itemId: string; code: string; name: string; unit: string; qty: string; rate: string; hint: string | null }

const fromSuggestion = (s: PoDraftLine, key: number): Line => ({
  key,
  itemId: s.item_id,
  code: s.item_code,
  name: s.item_name,
  unit: s.purchase_unit,
  qty: Number(s.suggested_qty) > 0 ? String(Number(s.suggested_qty)) : '',
  rate: s.last_rate === null ? '' : String(Number(s.last_rate)),
  hint: s.last_rate === null ? 'never billed by them' : `their last: ${formatMoneyString(s.last_rate)}`,
})

const fromExisting = (l: PoLineRow, key: number): Line => ({
  key,
  itemId: l.item_id,
  code: l.item_code,
  name: l.item_name,
  unit: l.purchase_unit,
  qty: String(Number(l.qty)),
  rate: Number(l.rate) > 0 ? String(Number(l.rate)) : '',
  hint: null,
})

export default function PoDraft({
  vendorId,
  vendorName,
  vendorPhone,
  today,
  suggestions = [],
  existing,
  poId,
}: {
  vendorId: string
  vendorName: string
  vendorPhone: string | null
  today: string
  suggestions?: PoDraftLine[]
  existing?: { poDate: string; expectedDate: string | null; note: string | null; lines: PoLineRow[] }
  poId?: string
}) {
  const router = useRouter()
  const [poDate] = useState(existing?.poDate ?? today)
  const [expected, setExpected] = useState(existing?.expectedDate ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [lines, setLines] = useState<Line[]>(
    existing !== undefined
      ? existing.lines.map(fromExisting)
      : suggestions.map(fromSuggestion),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)

  const patch = (key: number, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const drop = (key: number) => setLines((ls) => ls.filter((l) => l.key !== key))

  const filled = lines.filter((l) => l.qty.trim() !== '' && parseQty(l.qty.trim()) !== null)
  const totalPaise = useMemo(
    () =>
      filled.reduce((n, l) => {
        const q = parseQty(l.qty.trim())
        const r = l.rate.trim() === '' ? 0 : parseMoney(l.rate.trim())
        return q === null || r === null ? n : n + Math.round((q / 1000) * r)
      }, 0),
    [filled],
  )
  const noRate = filled.filter((l) => l.rate.trim() === '').length
  const canSave = filled.length > 0 && !busy

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    const payload = {
      vendorId,
      poDate,
      expectedDate: expected,
      note: note.trim(),
      lines: filled.map((l) => ({ itemId: l.itemId, qty: l.qty.trim(), rate: l.rate.trim(), note: '' })),
    }
    try {
      const res = poId === undefined
        ? await createPurchaseOrder(payload)
        : await updatePurchaseOrder(poId, payload)
      if (res.ok) {
        setAck({
          headline: `${res.doc_no ?? 'Order'} — ${vendorName}, ${filled.length} ${filled.length === 1 ? 'item' : 'items'}, ${formatMoneyString(String(totalPaise / 100))}`,
          sub: 'Saved as a DRAFT — nothing has gone to the vendor. It stays editable until you send it, and freezes the moment you do.',
        })
        // NAVIGATES ON PURPOSE, and only when the next act is genuinely
        // elsewhere: a saved DRAFT is not finished — it has to be sent, and
        // sending lives on the order's own page. Editing an existing draft
        // stays put, because there the reveal IS the answer.
        if (poId === undefined) router.push(`/store/purchasing/orders/${res.id}`)
        else router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {ack !== null && <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />}

      <section className={cardCls}>
        <h2 className={sectionHeadCls}>{vendorName}</h2>
        {vendorPhone === null && (
          <div className="mt-2">
            {/* THE BLOCKER, SAID WHERE IT BITES. An order with nowhere to send
                it is a PDF, and finding that out at the send button is finding
                it out too late. */}
            <Honesty verdict="no phone number" level="alarm" action={{ href: `/store/masters/vendors`, label: 'Add one on the vendor' }}>
              {vendorName} has no phone number on file, so this order cannot be sent over WhatsApp. It can still
              be saved and printed — but a purchase order with nowhere to send it is a PDF.
            </Honesty>
          </div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabelCls}>Order date</span>
            <input type="date" value={poDate} readOnly disabled className={`${numCls} w-full bg-stone-100`} />
            <span className="mt-1 block text-xs text-stone-500">
              The date the order carries. It cannot be changed later — a different date is a different order.
            </span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Needed by (optional)</span>
            <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={`${numCls} w-full`} />
          </label>
        </div>
      </section>

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>What to order</h2>
          <span className="font-mono text-[11px] text-stone-400">reorder_due · vendor_supplied_items</span>
        </div>
        {lines.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">
            Nothing from this vendor is at or below its reorder level. Set reorder levels on the item master,
            or add lines to an order raised by hand.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Item</th>
                  <th className={thNumCls}>Qty</th>
                  <th className={thCls}>Unit</th>
                  <th className={thNumCls}>Rate</th>
                  <th className={thNumCls}>Value</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const q = parseQty(l.qty.trim())
                  const r = l.rate.trim() === '' ? 0 : parseMoney(l.rate.trim())
                  const val = q === null || r === null ? null : Math.round((q / 1000) * r)
                  return (
                    <tr key={l.key} className={trCls}>
                      <td className={tdCls}>
                        <span className="block">{l.name}</span>
                        <span className={`${tdCodeCls} border-0 p-0`}>{l.code}</span>
                      </td>
                      <td className={tdNumCls}>
                        <input
                          value={l.qty}
                          onChange={(e) => patch(l.key, { qty: e.target.value })}
                          placeholder="0"
                          inputMode="decimal"
                          className={`${numCls} w-20 text-right`}
                        />
                      </td>
                      <td className={`${tdCls} text-stone-500`}>{l.unit}</td>
                      <td className={tdNumCls}>
                        <input
                          value={l.rate}
                          onChange={(e) => patch(l.key, { rate: e.target.value })}
                          placeholder="—"
                          inputMode="decimal"
                          className={`${numCls} w-24 text-right`}
                        />
                        {l.hint !== null && (
                          <span className="mt-0.5 block text-[10.5px] font-normal text-stone-400">{l.hint}</span>
                        )}
                      </td>
                      <td className={tdNumCls}>{val === null ? '—' : formatMoneyString(String(val / 100))}</td>
                      <td className={tdCls}>
                        <button type="button" onClick={() => drop(l.key)} className="text-xs text-stone-400 hover:text-red-700">
                          remove
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <label className="mt-3 block">
          <span className={fieldLabelCls}>Note to the vendor (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputCls} />
        </label>

        {noRate > 0 && (
          <div className="mt-3">
            {/* A BLANK RATE IS DELIBERATE, NOT AN OMISSION. This vendor has
                never billed these items, and quoting a price they never gave
                is worse than leaving it open. */}
            <Honesty verdict="no rate from them" compact>
              {noRate} {noRate === 1 ? 'line has' : 'lines have'} no rate, because {vendorName} has never billed
              {noRate === 1 ? ' that item' : ' those items'}. The order goes out without a price on
              {noRate === 1 ? ' it' : ' them'} rather than quoting a figure they never gave — the total below
              covers only the lines that have one.
            </Honesty>
          </div>
        )}

        {error !== null && (
          <p role="alert" className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-stone-600">
            {filled.length} {filled.length === 1 ? 'item' : 'items'} ·{' '}
            <b className="font-mono tabular-nums">{formatMoneyString(String(totalPaise / 100))}</b> at our last
            rates
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => router.back()} className={btnGhostCls} disabled={busy}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={!canSave} className={`${btnCls} disabled:bg-stone-300`}>
              {busy ? 'Saving…' : poId === undefined ? 'Save draft' : 'Save changes'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
