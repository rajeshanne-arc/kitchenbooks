'use client'

// THE STYLE PICKER — three thumbnails that ARE the templates.
//
// Zoho, QuickBooks, Xero and Wave all show pictures; a list of style names is
// worse than any of them. But a THUMBNAIL IMAGE is a hand-maintained copy of a
// template, and it lies the day the layout changes — the same fault as a gate
// carrying its own copy of the thing it checks, in a place nobody would think
// to look for it.
//
// So each tile renders <PoDocument> itself, at small scale, through the same
// component the printed page uses. No assets, nothing to regenerate, and it
// cannot drift: change the document and the picker changes with it.

import PoDocument from '@/components/store/PoDocument'
import { DOCUMENT_STYLE_NAMES, DOCUMENT_STYLE_USES } from '@/lib/letterhead'
import { DOCUMENT_STYLES, type DocumentStyle, type Letterhead } from '@/lib/types'

/**
 * A plausible order, for the thumbnails only.
 *
 * Never written anywhere and never near a real one — this is the shape of a
 * document, so that the picker shows what a layout DOES rather than three
 * empty frames.
 */
const SAMPLE_PO = {
  id: 'sample',
  doc_no: 'PO-2627-0042',
  po_date: '2026-08-24',
  expected_date: '2026-08-26',
  status: 'sent',
  vendor_id: 'sample',
  vendor_code: 'V-VEG-01',
  vendor_name: 'Venkata Narasimha Vegetables',
  vendor_phone: '98765 43210',
  note: null,
  total: '4310',
  lines: 3,
} as unknown as Parameters<typeof PoDocument>[0]['po']

const SAMPLE_LINES = [
  { id: 'a', item_id: 'a', item_code: 'VEG-027', item_name: 'Onions', purchase_unit: 'kg', qty: '50', rate: '36', amount: '1800' },
  { id: 'b', item_id: 'b', item_code: 'VEG-015', item_name: 'Garlic', purchase_unit: 'kg', qty: '5', rate: '185', amount: '925' },
  { id: 'c', item_id: 'c', item_code: 'VEG-044', item_name: 'Ginger', purchase_unit: 'kg', qty: '4', rate: '205', amount: '820' },
] as unknown as Parameters<typeof PoDocument>[0]['lines']

/** Which letterhead fields a document needs, so the picker can say which of the
 *  values on screen are Rajesh's and which are stand-ins. */
const SAMPLES: { key: keyof Letterhead; label: string; value: string }[] = [
  { key: 'legal_name', label: 'legal name', value: 'Thrayam Restaurant Pvt Ltd' },
  { key: 'address_line1', label: 'address', value: '12 Beach Road' },
  { key: 'city', label: 'city', value: 'Visakhapatnam' },
  { key: 'state', label: 'state', value: 'Andhra Pradesh' },
  { key: 'pincode', label: 'pincode', value: '530017' },
  { key: 'phone', label: 'phone', value: '0891 234 5678' },
  { key: 'gstin', label: 'GSTIN', value: '37AABCT1234M1Z5' },
  { key: 'fssai_number', label: 'FSSAI number', value: '12345678901234' },
]

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

export default function StylePicker({
  value,
  onChange,
  letterhead,
}: {
  value: DocumentStyle
  onChange: (s: DocumentStyle) => void
  /** the live letterhead as it is being typed — the preview becomes the real
   *  document as the fields fill in */
  letterhead: Letterhead
}) {
  // FILL THE GAPS AND SAY WHICH ARE FILLED. Every one of these eight fields is
  // empty on this restaurant today, and a picker showing a complete document
  // Rajesh does not have is the same lie as a dashboard showing zero for data
  // that never arrived. The stand-ins go in, and the sentence underneath names
  // them — so the preview becomes the real document as he types.
  const substituted = SAMPLES.filter((sm) => blank(letterhead[sm.key]))
  const shown: Letterhead = { ...letterhead }
  for (const sm of substituted) {
    ;(shown as Record<string, unknown>)[sm.key] = sm.value
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        {DOCUMENT_STYLES.map((s) => {
          const on = s === value
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              aria-pressed={on}
              className={`group block rounded-xl border-2 p-2 text-left transition ${
                on ? 'border-emerald-700 bg-emerald-50/40' : 'border-rule bg-cell hover:border-emerald-400'
              }`}
            >
              {/* THE TEMPLATE ITSELF, at a third scale. A fixed-height window
                  with the real document scaled inside it: the thumbnail cannot
                  disagree with the page because it IS the page. */}
              <div className="relative h-52 overflow-hidden rounded-lg border border-rule bg-white">
                <div
                  aria-hidden
                  className="pointer-events-none absolute left-0 top-0 origin-top-left"
                  style={{ width: s === 'message' ? '380px' : '760px', transform: `scale(${s === 'message' ? 0.62 : 0.31})` }}
                >
                  <PoDocument po={SAMPLE_PO} lines={SAMPLE_LINES} letterhead={shown} style={s} preview />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className={`text-sm font-semibold ${on ? 'text-emerald-800' : 'text-stone-900'}`}>
                  {DOCUMENT_STYLE_NAMES[s]}
                </span>
                {on && <span className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">in use</span>}
              </div>
              {/* THE DIFFERENCE IS THE SITUATION IT IS READ IN, not the font.
                  That is why there are three and not sixteen. */}
              <p className="mt-0.5 text-[12.5px] leading-snug text-stone-600">{DOCUMENT_STYLE_USES[s]}</p>
            </button>
          )
        })}
      </div>

      {substituted.length > 0 && (
        <p className="mt-2.5 rounded-lg border border-dashed border-amber-400 bg-amber-50/60 px-3 py-2 text-[12.5px] text-amber-900">
          <b>{substituted.length} of the details above are stand-ins</b> — {substituted.map((s) => s.label).join(', ')} —
          because this restaurant has not said them yet. The items and the order number are made up too. Fill
          the fields in and the preview becomes the real document.
        </p>
      )}
    </div>
  )
}
