'use client'

// Goods going back to the vendor. The kitchen→store return already existed;
// this is the other direction, and the thing it exists for is the CREDIT: bad
// goods leave and the money has to be chased.
//
// THREE THINGS THE FORM USED TO ASK PEOPLE TO REMEMBER, and now does not:
//
//   the ITEM   — once the vendor is picked, the picker leads with what that
//                vendor has actually supplied, most recent first. It SCOPES
//                WITHOUT EXCLUDING: a vendor can send something they have
//                never sent before, and that is half of why goods go back, so
//                the general search stays underneath.
//   the RATE   — prefilled from that vendor's last bill for the item, with
//                `source_purchase_line_id` recorded beside it so the number
//                has a provenance instead of a memory. The screen used to say
//                "normally the rate on the bill these arrived on", which was
//                the app asking somebody to look up something it was holding.
//   the WHOLE  — or skip all of it and START FROM THE BILL, the way a short is
//   DELIVERY     recorded. Pick the bill, see its lines, send some back;
//                vendor, item and rate all come free.
//
// A PREFILL IS NOT A SUBSTITUTION. Every rate stays editable — a vendor does
// not always credit at the price they charged, and the claim has to be able to
// say so.
//
// REASON IS PER LINE. A rotten crate and a wrongly-picked item go back on the
// same trip for two different reasons: one is a quality problem with the
// supplier and the other is a picking mistake, and one shared header reason
// made one of them false. There is no header reason at all now — the list
// reads the lines and says "Quality" or "Mixed".

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  BillReturnPrefill,
  IssuableItemHit,
  ItemSuggestion,
  ReturnableBillRow,
  VendorReturnInput,
  VendorSel,
} from '@/lib/types'
import { saveVendorReturn } from '@/server/vendor-return-actions'
import { formatMicro, formatMoneyString, lineValueMicro, parseMoney, parseQty, sumMicro } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { toast } from '@/components/Toasts'
import VendorPicker from '@/components/VendorPicker'
import IssueItemPicker from '@/components/store/IssueItemPicker'
import { useBusinessToday } from '@/components/BusinessDay'
import {
  btnCls,
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  selectCls,
  thCls,
  thNumCls,
} from '@/components/ui'

type Line = {
  key: number
  item: IssuableItemHit | null
  qty: string
  rate: string
  reason: string
  /** the bill line these goods arrived on — the rate's provenance */
  sourceLineId: string
  /** what the bill said arrived, when this line came off one. Context beside
   *  the box: nobody can send back more than turned up. */
  billedQty: string | null
}
const newLine = (key: number): Line => ({
  key,
  item: null,
  qty: '',
  rate: '',
  reason: '',
  sourceLineId: '',
  billedQty: null,
})

/** digits and at most one dot — the same keypad discipline as every other
 *  quantity field in the app */
const cleanNum = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export default function VendorReturnEntry({
  bills,
  reasons,
}: {
  /** recent live bills, so a return can be opened from the delivery it belongs
   *  to. Voided bills and reversals are already absent — there is nothing left
   *  on either for a vendor to credit. */
  bills: ReturnableBillRow[]
  /** the vendor_return_reason list. A typed value still saves and waits for an
   *  owner in Settings → Lists — LAW 2 as amended, because the person holding a
   *  rotten crate at the van cannot wait for anybody to log in. */
  reasons: string[]
}) {
  const businessToday = useBusinessToday()
  const router = useRouter()
  const [returnDate, setReturnDate] = useState(businessToday)
  const [vendor, setVendor] = useState<VendorSel | null>(null)
  // A vendor cannot be born on a return the way one is born on a bill: the
  // goods came from somebody already on file. Typing a new name is answered
  // with where vendors are actually created, not with a silent no-op.
  const [newVendorName, setNewVendorName] = useState<string | null>(null)
  const [creditNoteRef, setCreditNoteRef] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** the bill this return was opened from, when it was */
  const [fromBill, setFromBill] = useState<BillReturnPrefill | null>(null)
  const [billBusy, setBillBusy] = useState(false)

  // The vendor is answered by the BILL when there is one, and by the picker
  // otherwise. Deriving it rather than writing the bill's vendor into the
  // picker's state keeps one source: a VendorHit carries a code, a category and
  // a balance, and manufacturing a half-filled one to satisfy the picker would
  // put values on screen that nothing looked up.
  const pickedVendorId = vendor?.kind === 'existing' ? vendor.hit.id : null
  const vendorId = fromBill?.vendor_id ?? pickedVendorId
  const vendorName = fromBill?.vendor_name ?? (vendor?.kind === 'existing' ? vendor.hit.name : null)

  // WHAT THIS VENDOR SUPPLIES, once the vendor is known. Keyed by the vendor it
  // was fetched for, so a stale batch can never be shown against another one —
  // a rate from the wrong supplier is a false claim, not a slow suggestion.
  const [supplied, setSupplied] = useState<{ vendorId: string; rows: ItemSuggestion[] } | null>(null)
  useEffect(() => {
    if (vendorId === null) return
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 10_000)
    fetch(`/api/vendors/items?vendor=${vendorId}`, { signal: ctl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ItemSuggestion[]) => {
        if (!ctl.signal.aborted) setSupplied({ vendorId, rows })
      })
      .catch(() => {
        /* a courtesy on top of a working form — the search still reaches everything */
      })
      .finally(() => clearTimeout(timer))
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
  }, [vendorId])
  const suppliedRows = supplied?.vendorId === vendorId ? supplied.rows : []

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

  /**
   * Open the return FROM a bill — the shorts pattern, other direction.
   *
   * QUANTITIES STAY BLANK. What arrived is not what is going back, and a
   * prefilled quantity would look exactly like a counted one. The bill's
   * quantity renders beside the empty box as context instead.
   */
  async function openFromBill(purchaseId: string) {
    setBillBusy(true)
    setError(null)
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 10_000)
    try {
      const res = await fetch(`/api/vendors/bill-lines?purchase=${purchaseId}`, {
        cache: 'no-store',
        signal: ctl.signal,
      })
      if (!res.ok) {
        setError('That bill cannot be opened as a return — reload the page and try another.')
        return
      }
      const p = (await res.json()) as BillReturnPrefill
      setFromBill(p)
      setVendor(null)
      setNewVendorName(null)
      setLines(
        p.lines.map((l, i) => ({
          key: nextKey + i,
          item: l.item,
          qty: '',
          rate: l.rate,
          reason: '',
          sourceLineId: l.purchase_line_id,
          billedQty: l.billed_qty,
        })),
      )
      setNextKey((k) => k + p.lines.length + 1)
    } catch {
      setError('Could not read that bill — the form still works from scratch.')
    } finally {
      clearTimeout(timer)
      setBillBusy(false)
    }
  }

  function dropBill() {
    setFromBill(null)
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
  }

  const lineMicro = (l: Line) => {
    const q = parseQty(l.qty)
    const r = parseMoney(l.rate)
    return l.item !== null && q !== null && q > 0 && r !== null && r > 0 ? lineValueMicro(q, r) : null
  }
  // A bill-opened return arrives with every line listed and none of them
  // filled in — sending back one crate out of six is the normal case. Only
  // lines somebody actually touched are saved.
  const touched = lines.filter((l) => l.item !== null && l.qty.trim() !== '')
  const canSave =
    !saving &&
    vendorId !== null &&
    touched.length > 0 &&
    touched.every((l) => lineMicro(l) !== null && l.reason !== '')
  const totalMicro = sumMicro(touched.map((l) => lineMicro(l) ?? 0n))

  async function onSave() {
    if (!canSave || vendorId === null) return
    setSaving(true)
    setError(null)
    const payload: VendorReturnInput = {
      date: returnDate,
      vendorId,
      creditNoteRef: creditNoteRef.trim(),
      note: note.trim(),
      lines: touched.map((l) => ({
        itemId: (l.item as IssuableItemHit).id,
        qty: l.qty.trim(),
        rate: l.rate.trim(),
        reason: l.reason,
        sourcePurchaseLineId: l.sourceLineId,
      })),
    }
    try {
      const res = await saveVendorReturn(payload)
      if (res.ok) {
        toast('Return recorded — it is now waiting on a credit note')
        setVendor(null)
        setNewVendorName(null)
        setCreditNoteRef('')
        setNote('')
        setFromBill(null)
        setLines([newLine(nextKey)])
        setNextKey((k) => k + 1)
        setReturnDate(businessToday)
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
      {/* START FROM THE BILL. Offered first because it is the better route: the
          receiver is holding the bill, and picking it answers the vendor, the
          items and the rates at once. The blank form stays right below for a
          return nobody can pin to a delivery. */}
      {fromBill === null ? (
        bills.length > 0 && (
          <section className={`${cardCls} border-emerald-200 bg-emerald-50/40`}>
            <h2 className={sectionHeadCls}>Start from the bill they came on</h2>
            <p className="mt-1 text-xs text-stone-600">
              Vendor, items and rates come with it — the same way a short is recorded against its bill.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {bills.slice(0, 8).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  disabled={billBusy}
                  onClick={() => void openFromBill(b.id)}
                  className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-left text-sm font-medium text-emerald-900 hover:border-emerald-600 disabled:opacity-50"
                >
                  {b.vendor_name} · {fmtDate(b.bill_date)} ·{' '}
                  <span className="font-mono tabular-nums">{formatMoneyString(b.bill_total)}</span>
                </button>
              ))}
            </div>
            {bills.length > 8 && (
              <label className="mt-3 block">
                <span className={fieldLabelCls}>Older bills</span>
                <select
                  value=""
                  disabled={billBusy}
                  onChange={(e) => {
                    if (e.target.value !== '') void openFromBill(e.target.value)
                  }}
                  className={selectCls}
                >
                  <option value="">— pick a bill —</option>
                  {bills.slice(8).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.vendor_name} · {fmtDate(b.bill_date)} · {b.bill_no ?? b.doc_no ?? 'no number'}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
        )
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-3">
          <span className="min-w-0 text-sm text-emerald-900">
            From <span className="font-semibold">{fromBill.vendor_name}</span>&apos;s bill of{' '}
            {fmtDate(fromBill.bill_date)}
            {fromBill.bill_no !== null && <> · {fromBill.bill_no}</>} — every line is listed, fill in only what
            is going back.
          </span>
          <button
            type="button"
            onClick={dropBill}
            className="shrink-0 rounded-lg border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-800 hover:border-emerald-500"
          >
            start blank
          </button>
        </div>
      )}

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
            {fromBill !== null ? (
              // Answered by the bill. Changing it here would leave every rate
              // and every provenance pointing at the wrong supplier, so the
              // way to change it is to start blank.
              <div className="flex items-center justify-between gap-3 rounded-lg border border-rule bg-ground px-3 py-2">
                <span className="text-[15px] font-medium text-stone-900">{fromBill.vendor_name}</span>
                <span className="text-xs text-stone-500">from the bill</span>
              </div>
            ) : (
              <>
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
                    “{newVendorName}” is not on file. Goods can only go back to a vendor who sent them — add
                    the vendor under Masters → Vendors, or enter the bill first.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* A TABLE, on the shared column vocabulary. Four controls to a line —
          item, quantity, rate, reason — which is the width a row can still
          carry; past that it would have to become cards. */}
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>What is going back</h2>
        <div className="mt-2 overflow-x-auto">
          <table className={dataTableCls}>
            <thead>
              <tr>
                <th className={`${thCls} w-[28%]`}>Item</th>
                <th className={`${thNumCls} w-[6.5rem]`}>Qty</th>
                <th className={`${thCls} w-[4.5rem]`}>Unit</th>
                <th className={`${thNumCls} w-[7rem]`}>Rate</th>
                <th className={`${thCls} w-[9rem]`}>Why</th>
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
                        suggestions={suppliedRows}
                        suggestLabel={
                          vendorName !== null ? `${vendorName} has supplied` : 'Supplied by this vendor'
                        }
                        /* THE RATE COMES WITH THE ITEM, and so does where it
                           came from. Both are only taken from a SUGGESTION: a
                           plain search hit carries neither, and inventing one
                           would put a provenance on a number nobody sourced. */
                        onPick={(hit, sug) =>
                          patchLine(line.key, {
                            item: hit,
                            ...(sug?.last_rate != null
                              ? {
                                  rate: sug.last_rate,
                                  sourceLineId: sug.source_purchase_line_id ?? '',
                                }
                              : {}),
                          })
                        }
                        onClear={() =>
                          patchLine(line.key, { item: null, rate: '', sourceLineId: '', billedQty: null })
                        }
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
                      {/* what the bill said arrived — context, not a prefill */}
                      {line.billedQty !== null && (
                        <span className="mt-0.5 block text-right font-mono text-[10px] tabular-nums text-stone-400">
                          billed {line.billedQty}
                        </span>
                      )}
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
                        onChange={(e) =>
                          // Editing the rate DROPS the provenance: the number
                          // is no longer the one that bill charged, and a
                          // source line pointing at a different figure would
                          // be a false citation.
                          patchLine(line.key, { rate: cleanNum(e.target.value), sourceLineId: '' })
                        }
                        className={`${numCls} w-full text-right font-mono tabular-nums`}
                      />
                      {line.sourceLineId !== '' && (
                        <span className="mt-0.5 block text-right text-[10px] text-emerald-700">
                          from their bill
                        </span>
                      )}
                    </td>
                    <td className="border-b border-rule-soft px-1 py-1.5">
                      {/* PER LINE. Two crates go back on one trip for two
                          reasons, and only one of them is the supplier's
                          fault. */}
                      <select
                        aria-label={`Reason, line ${i + 1}`}
                        value={line.reason}
                        onChange={(e) => patchLine(line.key, { reason: e.target.value })}
                        className={selectCls}
                      >
                        <option value="">—</option>
                        {reasons.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
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
          <span className="text-sm font-medium text-stone-500">
            Credit claimed{touched.length > 0 && <> · {touched.length} {touched.length === 1 ? 'line' : 'lines'}</>}
          </span>
          <span className="font-mono text-2xl font-bold tabular-nums text-stone-900">
            {formatMicro(totalMicro)}
          </span>
        </div>
        <p className="mt-1 text-xs text-stone-500">
          The rate is what the credit is claimed at. It arrives filled in from this vendor&apos;s last bill for
          the item and stays yours to change — a vendor does not always credit at the price they charged. It
          comes off what we owe them as soon as it is saved.
        </p>
        {reasons.length === 0 && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            No vendor return reasons are set up yet — add them under Settings → Lists.
          </p>
        )}
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
