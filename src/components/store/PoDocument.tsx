// THE DOCUMENT — three layouts, chosen per restaurant in settings.
//
// A STYLE IS ALLOWED TO BE A SETTING because it cannot make two restaurants'
// figures mean different things. That is the whole test, and a choice of
// layout passes it cleanly where a choice about what goes inside cost of goods
// never could.
//
// LETTERHEAD IS PREFILLED FROM THE RESTAURANT RECORD, and every field it is
// MISSING is named on the screen rather than silently left out. A purchase
// order with no address is a list of items from nobody, and a document that
// simply omits the line looks like a design decision instead of a gap.
//
// It prints through the browser rather than a PDF library: `globals.css`
// already says app furniture does not print, this page carries none, and a
// vendor gets the same thing whether it is printed or saved as a PDF.

import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { missingLetterheadFields } from '@/lib/letterhead'
import type { DocumentStyle, Letterhead, PoLineRow, PurchaseOrderRow } from '@/lib/types'

function Head({ l, style }: { l: Letterhead; style: DocumentStyle }) {
  const addr = [l.address_line1, l.address_line2, [l.city, l.state, l.pincode].filter(Boolean).join(' ')]
    .filter((x) => x !== null && String(x).trim() !== '')
    .join(', ')
  const ids = [l.gstin === null ? null : `GSTIN ${l.gstin}`, l.fssai_number === null ? null : `FSSAI ${l.fssai_number}`]
    .filter((x) => x !== null)
    .join(' · ')
  const reach = [l.phone, l.email].filter((x) => x !== null && String(x).trim() !== '').join(' · ')

  if (style === 'message') {
    return (
      <div className="mb-4">
        <div className="text-[15px] font-semibold">{l.legal_name ?? l.name}</div>
        {addr !== '' && <div className="text-[12px]">{addr}</div>}
        {reach !== '' && <div className="text-[12px]">{reach}</div>}
        {ids !== '' && <div className="text-[12px]">{ids}</div>}
      </div>
    )
  }
  if (style === 'compact') {
    return (
      <div className="mb-3 flex items-start justify-between gap-4 border-b border-stone-900 pb-2">
        <div className="flex items-center gap-2">
          {l.logo_url !== null && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.logo_url} alt="" className="h-8 w-8 object-contain" />
          )}
          <div>
            <div className="font-display text-[15px] font-bold">{l.legal_name ?? l.name}</div>
            {addr !== '' && <div className="text-[11px] text-stone-600">{addr}</div>}
          </div>
        </div>
        <div className="text-right text-[11px] text-stone-600">
          {reach !== '' && <div>{reach}</div>}
          {ids !== '' && <div>{ids}</div>}
        </div>
      </div>
    )
  }
  return (
    <div className="mb-5 border-b-2 border-stone-900 pb-3 text-center">
      {l.logo_url !== null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={l.logo_url} alt="" className="mx-auto mb-2 h-12 object-contain" />
      )}
      <div className="font-display text-xl font-bold tracking-tight">{l.legal_name ?? l.name}</div>
      {addr !== '' && <div className="mt-0.5 text-[12px] text-stone-700">{addr}</div>}
      {reach !== '' && <div className="text-[12px] text-stone-700">{reach}</div>}
      {ids !== '' && <div className="mt-0.5 text-[11px] text-stone-600">{ids}</div>}
    </div>
  )
}

/** The missing-field note. Not part of the document a vendor reads — it is a
 *  message to US about our own record, so it never prints and never appears in
 *  a thumbnail. */
function MissingNote({ missing }: { missing: string[] }) {
  return (
    <div className="mb-4 rounded-xl border border-dashed border-amber-400 bg-amber-50/60 p-3 text-[13px] text-amber-900 print:hidden">
      <b>This document is missing {missing.length} of the things a purchase order normally carries:</b>{' '}
      {missing.join(', ')}. It will print without {missing.length === 1 ? 'it' : 'them'} — a vendor reading it
      sees a list of items from a name with no address. Fill them in under Owner → Setup → Letterhead.
    </div>
  )
}

export default function PoDocument({
  po,
  lines,
  letterhead,
  style,
  preview = false,
}: {
  po: PurchaseOrderRow
  lines: PoLineRow[]
  letterhead: Letterhead
  style: DocumentStyle
  /** Rendered small, inside the style picker. Suppresses the note about our own
   *  missing fields — a thumbnail is showing the LAYOUT, and a banner about our
   *  record would be the loudest thing in it. */
  preview?: boolean
}) {
  const missing = missingLetterheadFields(letterhead)
  const priced = lines.filter((l) => Number(l.rate) > 0)
  const ruled = style !== 'message'

  // ── MESSAGE: PHONE-SHAPED, and it is not the A4 document with a narrower
  // margin. It exists because this app's delivery channel is WhatsApp, where
  // a six-column table becomes a grey smear a vendor has to pinch and drag.
  // Large type, ONE LINE PER ITEM, no table at all — the shape of a message
  // somebody reads on a phone with one thumb, standing up.
  if (style === 'message') {
    return (
      <div className="mx-auto max-w-[380px] bg-white px-5 py-6 text-stone-900 print:px-0">
        {!preview && missing.length > 0 && <MissingNote missing={missing} />}
        <div className="text-[17px] font-bold leading-tight">{letterhead.legal_name ?? letterhead.name}</div>
        {letterhead.phone !== null && <div className="text-[14px] text-stone-600">{letterhead.phone}</div>}

        <div className="mt-4 text-[15px]">
          <div className="font-semibold uppercase tracking-wide">Purchase order</div>
          <div className="font-mono text-[13px] text-stone-600">{po.doc_no ?? '—'}</div>
          <div className="text-[14px]">{fmtDate(po.po_date)}</div>
          {po.expected_date !== null && (
            <div className="text-[14px]">Needed by {fmtDate(po.expected_date)}</div>
          )}
        </div>

        <div className="mt-4 text-[15px]">
          <span className="text-stone-500">To </span>
          <span className="font-semibold">{po.vendor_name}</span>
        </div>

        {/* ONE LINE PER ITEM. Quantity first, because that is what the reader
            is being asked for; the rate follows in smaller type where it is
            known, and is simply absent where it is not. */}
        <ul className="mt-4 space-y-2.5">
          {lines.map((l, i) => (
            <li key={l.id} className="text-[16px] leading-snug">
              <span className="text-stone-400">{i + 1}. </span>
              <span className="font-semibold">
                {Number(l.qty)} {l.purchase_unit}
              </span>{' '}
              {l.item_name}
              {Number(l.rate) > 0 ? (
                <span className="block pl-5 text-[13px] text-stone-500">
                  at {formatMoneyString(l.rate)} — {formatMoneyString(l.amount)}
                </span>
              ) : (
                <span className="block pl-5 text-[13px] text-stone-400">rate to confirm</span>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-stone-300 pt-2 text-[16px]">
          <span className="text-stone-500">Total at our last rates </span>
          <span className="font-mono font-bold">{formatMoneyString(po.total)}</span>
        </div>

        {priced.length < lines.length && (
          <p className="mt-2 text-[13px] text-stone-600">
            {lines.length - priced.length} of {lines.length} have no rate yet — we have no bill from you for{' '}
            {lines.length - priced.length === 1 ? 'it' : 'them'}. Every rate above is what you last billed
            us, not a price we are setting.
          </p>
        )}
        {po.note !== null && po.note !== '' && <p className="mt-3 text-[14px]">{po.note}</p>}
        {po.status === 'cancelled' && (
          <p className="mt-3 font-semibold uppercase tracking-wide text-red-700">Cancelled</p>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-6 text-stone-900 print:p-0">
      {/* NAMED, NOT OMITTED — and it does not print, because it is a message
          to us about our own record, not part of the document a vendor reads. */}
      {!preview && missing.length > 0 && <MissingNote missing={missing} />}

      <Head l={letterhead} style={style} />

      <div className={`mb-3 flex flex-wrap items-baseline justify-between gap-3 ${ruled ? '' : 'border-b border-stone-400 pb-2'}`}>
        <div>
          <div className="font-display text-[17px] font-bold uppercase tracking-[0.08em]">Purchase order</div>
          <div className="font-mono text-[12px]">{po.doc_no ?? '—'}</div>
        </div>
        <div className="text-right text-[12px]">
          <div>Date: {fmtDate(po.po_date)}</div>
          {po.expected_date !== null && <div>Needed by: {fmtDate(po.expected_date)}</div>}
          {po.status === 'cancelled' && (
            <div className="mt-1 font-semibold uppercase tracking-wide text-red-700">Cancelled</div>
          )}
        </div>
      </div>

      <div className="mb-3 text-[13px]">
        <div className="text-[11px] uppercase tracking-wide text-stone-500">To</div>
        <div className="font-semibold">{po.vendor_name}</div>
        <div className="font-mono text-[11px] text-stone-500">{po.vendor_code}</div>
        {po.vendor_phone !== null && <div className="text-[12px]">{po.vendor_phone}</div>}
      </div>

      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className={ruled ? 'bg-stone-100' : ''}>
            <th className={`py-1.5 pr-2 text-left font-semibold ${ruled ? 'border-y border-stone-400' : 'border-b border-stone-400'}`}>#</th>
            <th className={`py-1.5 pr-2 text-left font-semibold ${ruled ? 'border-y border-stone-400' : 'border-b border-stone-400'}`}>Item</th>
            <th className={`py-1.5 pr-2 text-right font-semibold ${ruled ? 'border-y border-stone-400' : 'border-b border-stone-400'}`}>Qty</th>
            <th className={`py-1.5 pr-2 text-left font-semibold ${ruled ? 'border-y border-stone-400' : 'border-b border-stone-400'}`}>Unit</th>
            <th className={`py-1.5 pr-2 text-right font-semibold ${ruled ? 'border-y border-stone-400' : 'border-b border-stone-400'}`}>Rate</th>
            <th className={`py-1.5 text-right font-semibold ${ruled ? 'border-y border-stone-400' : 'border-b border-stone-400'}`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id} className={ruled ? 'border-b border-stone-200' : ''}>
              <td className="py-1.5 pr-2 text-stone-500">{i + 1}</td>
              <td className="py-1.5 pr-2">
                {l.item_name}
                <span className="ml-1.5 font-mono text-[10.5px] text-stone-400">{l.item_code}</span>
              </td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{Number(l.qty)}</td>
              <td className="py-1.5 pr-2 text-stone-600">{l.purchase_unit}</td>
              {/* A RATE THIS VENDOR NEVER GAVE IS NOT PRINTED. "To be confirmed"
                  invites the question; a borrowed figure invites agreement. */}
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                {Number(l.rate) > 0 ? formatMoneyString(l.rate) : <span className="text-stone-400">to confirm</span>}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums">
                {Number(l.rate) > 0 ? formatMoneyString(l.amount) : <span className="text-stone-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className={`py-2 pr-2 text-right font-semibold ${ruled ? 'border-t-2 border-stone-900' : 'border-t border-stone-400'}`}>
              Total at our last rates
            </td>
            <td className={`py-2 text-right font-mono font-bold tabular-nums ${ruled ? 'border-t-2 border-stone-900' : 'border-t border-stone-400'}`}>
              {formatMoneyString(po.total)}
            </td>
          </tr>
        </tfoot>
      </table>

      {priced.length < lines.length && (
        <p className="mt-2 text-[11.5px] text-stone-600">
          {lines.length - priced.length} of {lines.length} {lines.length === 1 ? 'line has' : 'lines have'} no
          rate — we have no bill from you for {lines.length - priced.length === 1 ? 'it' : 'them'} yet. The
          total covers the rest, and every rate above is what you last billed us, not a price we are setting.
        </p>
      )}

      {po.note !== null && po.note !== '' && <p className="mt-3 text-[12.5px]">{po.note}</p>}

      {style === 'classic' && (
        <div className="mt-10 flex justify-end">
          <div className="w-56 border-t border-stone-500 pt-1 text-center text-[11.5px] text-stone-600">
            For {letterhead.legal_name ?? letterhead.name}
          </div>
        </div>
      )}
    </div>
  )
}
