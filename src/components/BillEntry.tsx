'use client'

import { useEffect, useMemo, useState } from 'react'
import type { BillPrefillLine, Category, ItemSel, SaveBillInput, SavedBill, Unit, VendorSel } from '@/lib/types'
import {
  decimalStringToPaise,
  formatMicro,
  formatPaise,
  lineValueMicro,
  microToPaise,
  parseMoney,
  parseQty,
  sumMicro,
} from '@/lib/money'
import { saveBill } from '@/server/save-bill'
import VendorPicker from './VendorPicker'
import ItemPicker from './ItemPicker'
import SaveReveal from './SaveReveal'
import { inputCls, numCls } from './ui'
import { sectionHeadCls, selectCls } from '@/components/ui'
import { priceMove } from '@/lib/price'
import { fmtDate } from '@/lib/format'
import { useBusinessToday } from '@/components/BusinessDay'

type Line = { key: number; item: ItemSel | null; qty: string; rate: string; prefillRate: string | null; expiryDate: string }

const newLine = (key: number): Line => ({ key, item: null, qty: '', rate: '', prefillRate: null, expiryDate: '' })

/**
 * THE ONE PLACE AN ITEM BECOMES A BILL LINE. Both paths go through it — the
 * picker and a purchase-order prefill — because the bug it replaces was a
 * PARTIAL line: the PO path hand-built a four-field `hit` and cast it, so
 * `category`, `unit_name` and `tracks_expiry` were all `undefined` on a
 * prefilled line and nowhere else. The first showed as an orphan separator, the
 * second as a missing unit, and the third is FALSY — so the expiry field simply
 * did not render, on exactly the items that require one.
 *
 * Adding tracks_expiry to the PO path would have fixed one of three and left
 * the shape divergent. A line is built here or it is not built.
 *
 * A prefill differs from a fresh line ONLY in the qty and rate it arrives with;
 * `expiryDate` always starts blank, because an expiry belongs to the item that
 * was picked and must not survive picking a different one.
 */
const lineFrom = (
  key: number,
  item: ItemSel,
  prefillRate: string | null,
  arriving: { qty?: string; rate?: string } = {},
): Line => ({
  key,
  item,
  prefillRate,
  qty: arriving.qty ?? '',
  rate: arriving.rate ?? prefillRate ?? '',
  expiryDate: '',
})

/** keep free typing but drop anything that can never be part of an amount */
const sanitizeAmount = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

type OrderAnswer = {
  key: string
  rows: { id: string; doc_no: string | null; po_date: string; lines: number }[]
}

export default function BillEntry({
  categories,
  units,
  thresholdPct,
}: {
  categories: Category[]
  units: Unit[]
  /** settings.price_variance_threshold_pct, resolved on the server. */
  thresholdPct: number
}) {
  const businessToday = useBusinessToday()
  const [billDate, setBillDate] = useState(businessToday)
  const [vendor, setVendor] = useState<VendorSel | null>(null)
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [nextKey, setNextKey] = useState(2)
  // AGAINST A PURCHASE ORDER, when there is one. Optional and always was: a
  // delivery can arrive against no order at all, which is how every bill in
  // this app was entered before orders existed. What citing one adds is a
  // COMPARISON — po_fulfilment counts only bills that name an order — so a
  // bill without it is not wrong, merely uncompared.
  // The answer is stored WITH the vendor it answers for, so a list fetched for
  // one vendor can never render under another — no clearing, no flash.
  const [orderAnswer, setOrders] = useState<OrderAnswer | null>(null)
  const [poIdRaw, setPoId] = useState('')
  const [extrasOpen, setExtrasOpen] = useState(false)
  const [gst, setGst] = useState('')
  const [transport, setTransport] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedBill | null>(null)

  // The order list follows the vendor, and clears with it: an order belongs to
  // one vendor, and offering another's would let a delivery be filed against a
  // document nobody sent them. The server refuses that too.
  //
  // KEYED, NOT CLEARED. The two setState calls that used to open this effect —
  // blanking the order id and emptying the list — ran synchronously on every
  // vendor change, which is a cascading render and is what
  // react-hooks/set-state-in-effect names. Both are DERIVED below instead: the
  // answer is stored against the vendor it answers for, so a stale list is
  // never shown under a new vendor and nothing has to be cleared to prevent it.
  const vendorKey = vendor?.kind === 'existing' ? vendor.hit.id : null
  const orders = orderAnswer !== null && orderAnswer.key === vendorKey ? orderAnswer.rows : []
  // The chosen order is only a choice while it belongs to the vendor on screen.
  const poId = orders.some((o) => o.id === poIdRaw) ? poIdRaw : ''
  useEffect(() => {
    if (vendorKey === null) return
    // ABORTED ON UNMOUNT AND CAPPED IN TIME. A pending fetch is enough to keep
    // a document from reaching idle, and a vendor picker that is changed twice
    // quickly would otherwise race its own answers onto the screen.
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 10_000)
    void fetch(`/api/vendors/orders?vendor=${vendorKey}`, { signal: ctl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { orders: [] }))
      .then((d: { orders?: OrderAnswer['rows'] }) => {
        if (!ctl.signal.aborted) setOrders({ key: vendorKey, rows: d.orders ?? [] })
      })
      .catch(() => {
        if (!ctl.signal.aborted) setOrders({ key: vendorKey, rows: [] })
      })
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
  }, [vendorKey])

  /** Prefill from the order — WHAT WAS ASKED FOR, which the receiver then
   *  corrects to what arrived. The quantities are an offer, not a count; the
   *  whole value of the comparison is that the two can differ. */
  async function loadOrder(id: string) {
    setPoId(id)
    if (id === '') return
    // Called from a change handler rather than an effect, so nothing else
    // would ever clean it up — the timeout is the abort path.
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 10_000)
    try {
      const r = await fetch(`/api/vendors/orders?po=${id}`, { signal: ctl.signal, cache: 'no-store' })
      if (!r.ok) return
      const d = (await r.json()) as { lines: BillPrefillLine[] }
      if (d.lines.length === 0) return
      setLines(
        // NO CAST. The `as Line[]` that used to sit here is what let a
        // four-field object pass as a thirteen-field ItemHitExisting; the hit
        // now arrives whole from the server and the constructor does the rest.
        d.lines.map((l, i) =>
          lineFrom(nextKey + i, { kind: 'existing', hit: l.hit }, l.hit.prefill_rate, {
            qty: String(Number(l.qty)),
            // WHAT WAS ORDERED wins over what the vendor last charged: this is
            // the price the order was placed at, and the gap between it and
            // what is billed is the whole point of receiving against an order.
            rate: Number(l.rate) > 0 ? String(Number(l.rate)) : '',
          }),
        ),
      )
      setNextKey((k) => k + d.lines.length + 1)
    } catch {
      /* the form is usable without the prefill; silence here is not a lost entry */
    } finally {
      clearTimeout(timer)
    }
  }

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

  const computed = useMemo(() => {
    const perLine = lines.map((l) => {
      const q = parseQty(l.qty)
      const r = parseMoney(l.rate)
      const micro = q !== null && q > 0 && r !== null ? lineValueMicro(q, r) : null
      return { q, r, micro }
    })
    const goodsMicro = sumMicro(perLine.map((p) => p.micro ?? 0n))
    const gstP = gst.trim() === '' ? 0 : parseMoney(gst)
    const trP = transport.trim() === '' ? 0 : parseMoney(transport)
    const totalPaise = microToPaise(goodsMicro) + (gstP ?? 0) + (trP ?? 0)
    return { perLine, goodsMicro, gstP, trP, totalPaise }
  }, [lines, gst, transport])

  const itemReady = (it: ItemSel | null): it is ItemSel =>
    it !== null &&
    (it.kind === 'existing' ||
      (it.kind === 'starter' ? it.unit !== '' : it.name.trim() !== '' && it.category !== '' && it.unit !== ''))
  const vendorReady =
    vendor !== null && (vendor.kind === 'existing' || (vendor.name.trim() !== '' && vendor.category !== ''))
  const linesReady = lines.length > 0 && lines.every((l, i) => itemReady(l.item) && computed.perLine[i].micro !== null)
  const extrasReady = computed.gstP !== null && computed.trP !== null
  const canSave = vendorReady && linesReady && extrasReady && !saving

  const onSave = async () => {
    if (!canSave || vendor === null) return
    setSaving(true)
    setError(null)
    const payload: SaveBillInput = {
      billDate,
      purchaseOrderId: poId,
      vendor:
        vendor.kind === 'existing'
          ? { kind: 'existing', id: vendor.hit.id }
          : { kind: 'new', name: vendor.name.trim(), category: vendor.category },
      lines: lines.map((l) => {
        const it = l.item as ItemSel
        return {
          item:
            it.kind === 'existing'
              ? { kind: 'existing' as const, id: it.hit.id }
              : it.kind === 'starter'
                ? { kind: 'starter' as const, starterId: it.hit.starter_id, unit: it.unit }
                : { kind: 'new' as const, name: it.name.trim(), category: it.category, unit: it.unit },
          qty: l.qty.trim(),
          rate: l.rate.trim(),
          expiryDate: l.expiryDate.trim(),
        }
      }),
      gstTotal: gst.trim() === '' ? '0' : gst.trim(),
      transport: transport.trim() === '' ? '0' : transport.trim(),
    }
    try {
      const res = await saveBill(payload)
      if (res.ok) {
        setSaved(res)
        resetForNext()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — the bill was not saved. Check your connection and retry.')
    } finally {
      setSaving(false)
    }
  }

  /** RESET FOR THE NEXT ENTRY, KEEPING WHAT CARRIES — the rule the sheets
   *  settled on years ago: THE DATE STAYS, THE VENDOR CLEARS. A stack of
   *  bills entered in one sitting is usually one delivery day and always
   *  several suppliers, and snapping the date back to today would quietly
   *  re-date every bill after the first. */
  const resetForNext = () => {
    setVendor(null)
    setLines([newLine(nextKey)])
    setNextKey((k) => k + 1)
    setGst('')
    setTransport('')
    setExtrasOpen(false)
    setError(null)
  }

  const fmtAmt = (s: string) => {
    const p = parseMoney(s.trim())
    return p === null ? `₹${s}` : formatPaise(p)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 sm:px-6">
      {saved !== null && <SaveReveal saved={saved} onDismiss={() => setSaved(null)} />}
      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
          <label className="block">
            <span className={`mb-1 block ${sectionHeadCls}`}>Bill date</span>
            <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className={inputCls} />
          </label>
          <div>
            <span className={`mb-1 block ${sectionHeadCls}`}>Vendor</span>
            <VendorPicker categories={categories} value={vendor} onChange={setVendor} />
            {orders.length > 0 && (
              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-medium text-stone-500">
                  Against a purchase order? (optional)
                </span>
                <select value={poId} onChange={(e) => void loadOrder(e.target.value)} className={selectCls}>
                  <option value="">No order — a delivery nobody ordered on paper</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.doc_no ?? 'Order'} · {o.po_date} · {o.lines} items
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-stone-500">
                  Picking one fills in what was ordered. Change the quantities to what actually arrived — the
                  difference is the whole point, and it is what turns “they billed 16 and delivered 14” from a
                  note into a claim.
                </span>
              </label>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className={sectionHeadCls}>Items</h2>
        <div className="mt-1 divide-y divide-rule-soft">
          {lines.map((line, i) => (
            <LineRow
              thresholdPct={thresholdPct}
              key={line.key}
              line={line}
              index={i}
              categories={categories}
              units={units}
              /* the vendor is picked before the lines, so it scopes and ranks
                 the item picker and makes the rate prefill THEIRS. A vendor
                 being born on this bill has no history — null, no scope. */
              vendorId={vendor?.kind === 'existing' ? vendor.hit.id : null}
              vendorName={vendor?.kind === 'existing' ? vendor.hit.name : null}
              patch={(p) => patchLine(line.key, p)}
              remove={() => removeLine(line.key)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-3 w-full rounded-xl border border-dashed border-stone-300 py-2.5 text-sm font-medium text-stone-500 hover:border-emerald-400 hover:text-emerald-700"
        >
          ＋ Add line
        </button>
      </section>

      <section>
        {!extrasOpen ? (
          <button
            type="button"
            onClick={() => setExtrasOpen(true)}
            className="w-full rounded-2xl border border-dashed border-stone-300 bg-white/60 px-4 py-3 text-left text-sm text-stone-500 hover:border-emerald-400 hover:text-emerald-700"
          >
            ＋ Bill has GST or transport?
            {(gst.trim() !== '' || transport.trim() !== '') && (
              <span className="ml-2 font-medium text-stone-700">
                {gst.trim() !== '' && `GST ${fmtAmt(gst)}`}
                {gst.trim() !== '' && transport.trim() !== '' && ' · '}
                {transport.trim() !== '' && `Transport ${fmtAmt(transport)}`}
              </span>
            )}
          </button>
        ) : (
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className={sectionHeadCls}>GST & transport</h2>
              <button
                type="button"
                onClick={() => setExtrasOpen(false)}
                className="text-xs text-stone-400 hover:text-stone-600"
              >
                collapse
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-stone-500">GST total</span>
                <MoneyInput value={gst} onChange={setGst} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-stone-500">Transport</span>
                <MoneyInput value={transport} onChange={setTransport} />
              </label>
            </div>
            <p className="mt-2.5 text-xs text-stone-400">
              Transport spreads across lines by value (2 dp); leftover paise land on the biggest line so the split
              always sums exactly.
            </p>
          </div>
        )}
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* clearance for the fixed bar below — the bar is why this screen
          needs bottom room, so this screen reserves it rather than every
          layout in the app padding for a bar it does not have */}
      <div aria-hidden className="kb-fixed-bar-clearance h-20" />
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Bill total</div>
            <div className="text-3xl font-bold tabular-nums tracking-tight text-stone-900">
              {formatPaise(computed.totalPaise)}
            </div>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="rounded-xl bg-emerald-700 px-6 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {saving ? 'Saving…' : 'Save bill'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MoneyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const invalid = value.trim() !== '' && parseMoney(value.trim()) === null
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-stone-400">₹</span>
      <input
        inputMode="decimal"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(sanitizeAmount(e.target.value))}
        className={`${inputCls} pl-7 ${invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : ''}`}
      />
    </div>
  )
}

function LineRow({
  line,
  index,
  categories,
  units,
  vendorId,
  vendorName,
  thresholdPct,
  patch,
  remove,
}: {
  line: Line
  index: number
  categories: Category[]
  units: Unit[]
  vendorId: string | null
  vendorName: string | null
  /** settings.price_variance_threshold_pct — a restaurant's own idea of how
   *  big a move is worth a word, not a rule about what a number means. */
  thresholdPct: number
  patch: (p: Partial<Line>) => void
  remove: () => void
}) {
  const q = parseQty(line.qty)
  const r = parseMoney(line.rate)
  const micro = q !== null && q > 0 && r !== null ? lineValueMicro(q, r) : null
  // THE OLD CHIP COMPARED ACROSS VENDORS, which is the one comparison that
  // must never be made. It read `line.prefillRate` whatever its source, at a
  // hardcoded 15% — so on an item this vendor had never billed it measured the
  // typed rate against ANOTHER vendor's price and called a correct entry a
  // rise. Measured: Chicken Boneless is ₹330 from RR and ₹300 from Sneha, so
  // every Sneha bill for it would have been flagged. A warning that fires on
  // correct entries is a warning people learn to dismiss, which costs more
  // than never having built it.
  //
  // The rule is in lib/price.ts and refuses unless rate_source is 'vendor', so
  // the cross-vendor comparison cannot be reintroduced by forgetting.
  const hit = line.item?.kind === 'existing' ? line.item.hit : null
  const move = priceMove({
    typed: line.rate,
    previous: hit?.rate_source === 'vendor' ? hit.prefill_rate : null,
    previousDate: hit?.last_bought ?? null,
    rateSource: hit?.rate_source ?? null,
    qty: line.qty,
    thresholdPct,
    fmtDate,
  })

  const unitName = line.item?.kind === 'existing' ? line.item.hit.unit_name : null

  return (
    <div className="space-y-2 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ItemPicker
            categories={categories}
            units={units}
            vendorId={vendorId}
            vendorName={vendorName}
            value={line.item}
            onPick={(sel, prefill) =>
              // THE SAME CONSTRUCTOR. The typed quantity survives — it comes off
              // the delivery note, not off the item — and the rate falls back to
              // whatever was already typed when the new item has no history.
              patch(lineFrom(line.key, sel, prefill, { qty: line.qty, rate: prefill ?? line.rate }))
            }
            onChange={(sel) => patch({ item: sel })}
            onClear={() => patch({ item: null, prefillRate: null })}
          />
        </div>
        <button
          type="button"
          onClick={remove}
          aria-label={`Remove line ${index + 1}`}
          className="mt-1.5 shrink-0 rounded-md p-1 text-stone-300 hover:bg-stone-100 hover:text-stone-600"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <input
          inputMode="decimal"
          placeholder="Qty"
          value={line.qty}
          onChange={(e) => patch({ qty: sanitizeAmount(e.target.value) })}
          className={`${numCls} w-24`}
        />
        {unitName !== null && <span className="text-sm text-stone-500">{unitName}</span>}
        <span className="text-stone-400">×</span>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-stone-400">
            ₹
          </span>
          <input
            inputMode="decimal"
            placeholder="Rate"
            value={line.rate}
            onChange={(e) => patch({ rate: sanitizeAmount(e.target.value) })}
            className={`${numCls} w-32 pl-7`}
          />
        </div>
        {/* ASKED ONLY WHERE THE ITEM CARRIES ONE. Onions have no printed
            date, and a required field on every line trains people to type
            anything — an invented date is worse than none, because the card
            that reads it would then be confidently wrong. */}
        {hit?.tracks_expiry === true && (
          <label className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Expires</span>
            <input
              type="date"
              value={line.expiryDate}
              onChange={(e) => patch({ expiryDate: e.target.value })}
              className={`${numCls} w-36`}
            />
          </label>
        )}
        {/* INLINE, AND IT DOES NOT BLOCK. The price may genuinely have gone
            up — the receiver is holding the bill and we are not. The job is
            to stop somebody typing a number they would have questioned had
            they noticed it. */}
        {move !== null && (
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              move.direction === 'up'
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-emerald-300 bg-emerald-50 text-emerald-800'
            }`}
          >
            {move.sentence}
          </span>
        )}
        <span className="ml-auto text-[15px] font-semibold tabular-nums text-stone-900">
          {micro !== null ? formatMicro(micro) : <span className="font-normal text-stone-300">—</span>}
        </span>
      </div>
    </div>
  )
}
