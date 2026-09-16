'use client'

// THE PAPER, OPENED WHERE YOU ARE STANDING.
//
// Somebody choosing a range or about to pay a request wants to look at one
// bill — and a link would take the screen away, lose a half-typed form and
// make them find their place again. A sheet is the answer to "show me that
// one" without answering "take me somewhere".
//
// THE FIRST SLIDE-OVER IN THIS APP, which is the thing to be careful about.
// Nothing here slid from an edge before: there is no drawer, no portal, no
// dialog library, no focus trap and no scroll lock anywhere in the repo. So
// every rule this codebase holds has met four confirm modals and one popover
// and has never met a full-height fixed panel — and the file's own lesson is
// that the FIRST instance of a new shape is where a rule that looked universal
// turns out to have been a coincidence.
//
//   Z-INDEX. The ladder is dropdowns 20 < PeriodControl 30 < TopNav 40 <
//   modals 50. A sheet at anything below 50 renders UNDER the nav — visible,
//   scrollable, and cut off across the top by a bar it cannot cover.
//
//   DISMISS. Escape and an outside click, copied from PeriodControl, which is
//   the only place in the app that already does both. The four confirm modals
//   have neither, so they are not the precedent.
//
// READ-ONLY, AND THERE IS NO WAY OUT OF IT. No edit, no void, and no link to
// the bill document — deliberately, because a link is how a sheet stops being
// a sheet. What it shows is what the paper says.
//
// IT DOES NOT UNMOUNT THE FORM UNDERNEATH. It is a sibling overlay driven by
// one piece of state in the parent, so a half-typed range, amount or note is
// exactly where it was when the sheet closes. A route would not have been.

import { useEffect, useRef, useState } from 'react'
import { loadBillSheet } from '@/server/books-actions'
import type { BillSheetRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { codeCls, docNoCls } from '@/components/ui'
import Honesty from '@/components/Honesty'

const kb = (n: number | null) => (n === null ? '—' : `${Math.max(1, Math.round(n / 1024))} KB`)

export default function BillSheet({
  purchaseId,
  onClose,
}: {
  /** ALWAYS A REAL ID. The parent renders this conditionally and keys it on
   *  the id, so opening a second bill REMOUNTS rather than showing the first
   *  one's lines under the second one's name — the `key={prefill?.id}` fix
   *  this repo already made once, for the same reason. It also means there is
   *  no early return before a hook, and no state to clear on the way in. */
  purchaseId: string
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [bill, setBill] = useState<BillSheetRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  // DERIVED, NOT STORED. A `busy` flag would have to be set synchronously at
  // the top of the effect, and `react-hooks/set-state-in-effect` is right to
  // refuse that — it is the shape that caused the letterhead remount. Nothing
  // and no error IS reading.
  const busy = bill === null && error === null

  useEffect(() => {
    let live = true
    loadBillSheet(purchaseId)
      .then((res) => {
        if (!live) return
        if (res.ok) setBill(res.bill)
        else setError(res.error)
      })
      .catch(() => {
        if (live) setError('Could not reach the server — the bill was not read.')
      })
    // A second click while the first read is in flight must not let the
    // slower answer win.
    return () => {
      live = false
    }
  }, [purchaseId])

  // ARIA-MODAL IS A PROMISE, AND THE MARKUP WAS MAKING ONE THE BEHAVIOUR DID
  // NOT KEEP.
  //
  // `aria-modal="true"` tells a screen reader that everything outside this
  // panel is inert. A keyboard could still Tab straight out of it — into the
  // pay form, the mode picker and the money-writing buttons underneath, which
  // a screen-reader user had just been told were not there. Saying a thing is
  // modal and leaving it traversable is worse than not claiming it: the claim
  // is what stops somebody looking.
  //
  // THREE PARTS, and the third is the one people forget. Trap Tab inside the
  // panel; close on Escape; and RETURN FOCUS to whatever opened it, because a
  // sheet that closes leaving focus on `document.body` drops a keyboard reader
  // at the top of the page with their place in the bill list gone.
  useEffect(() => {
    // The bill row that opened this. Captured before focus moves, restored on
    // the way out — and only if it is still in the document, since a row can
    // legitimately disappear while the sheet is open.
    const opener = document.activeElement as HTMLElement | null

    const focusable = (): HTMLElement[] =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)

    // FOCUS MOVES IN. Without this the first Tab goes to whatever followed the
    // opener in the document, which is outside the panel.
    const first = focusable()[0]
    if (first !== undefined) first.focus()
    else panel.current?.focus()

    const away = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) onClose()
    }
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        // NOTHING TO TAB TO, so Tab must not escape either — the panel itself
        // holds focus rather than handing it to the form underneath.
        e.preventDefault()
        panel.current?.focus()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      // WRAP AT BOTH ENDS, and also catch focus that is already outside — a
      // click on the overlay, or a browser restoring focus elsewhere.
      if (panel.current !== null && !panel.current.contains(active)) {
        e.preventDefault()
        firstEl.focus()
      } else if (e.shiftKey && active === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', keys)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', keys)
      if (opener !== null && document.contains(opener)) opener.focus()
    }
  }, [onClose])

  return (
    // z-50 puts it above the sticky nav at z-40. Below that and the top of the
    // sheet is hidden behind a bar the reader cannot scroll away.
    <div className="fixed inset-0 z-50 flex justify-end bg-stone-900/30">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Bill"
        /* -1 so it never enters the Tab order itself, but CAN hold focus when
           there is nothing inside to hold it. */
        tabIndex={-1}
        className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl sm:max-w-lg"
      >
        <div className="sticky top-0 flex items-baseline justify-between gap-3 border-b border-rule bg-white px-4 py-3">
          <h3 className="font-display text-base font-semibold text-stone-900">
            {bill === null ? 'Bill' : (bill.vendor_name ?? 'a vendor')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-rule px-2.5 py-1 text-sm text-stone-600 hover:bg-stone-50"
          >
            Close
          </button>
        </div>

        <div className="px-4 py-3">
          {busy && <p className="text-sm text-stone-400">Reading the bill…</p>}

          {error !== null && (
            <Honesty verdict="the bill did not load" level="alarm">
              {error}
            </Honesty>
          )}

          {bill !== null && (
            <>
              {/* THE VIEW'S OWN COLUMNS, never derived. A bill is voided by a
                  negative twin, and `is_voided` / `is_reversal` are what
                  `bills` publishes about that pair. */}
              {bill.is_voided && (
                <div className="mb-3">
                  <Honesty verdict="voided" level="alarm">
                    This bill was cancelled by a reversal. It is on the record and it counts for nothing.
                  </Honesty>
                </div>
              )}
              {bill.is_reversal && (
                <div className="mb-3">
                  <Honesty verdict="a reversal">
                    This IS the reversal — the negative twin that cancelled another bill.
                  </Honesty>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-stone-500">Vendor</dt>
                <dd className="text-stone-900">
                  <span className={codeCls}>{bill.vendor_code}</span> {bill.vendor_name}
                </dd>
                <dt className="text-stone-500">Their bill no.</dt>
                <dd className="text-stone-900">{bill.bill_no ?? 'not given'}</dd>
                <dt className="text-stone-500">Bill date</dt>
                <dd className="text-stone-900">{fmtDate(bill.bill_date)}</dd>
                <dt className="text-stone-500">Due</dt>
                <dd className="text-stone-900">
                  {bill.due_date !== null ? (
                    fmtDate(bill.due_date)
                  ) : bill.unpaid !== null ? (
                    // A DUE DATE NOBODY AGREED TO IS WORSE THAN NONE — the
                    // ageing already refuses to invent one, and so does this.
                    <span className="text-amber-800">no payment terms set</span>
                  ) : (
                    <span className="text-stone-400">nothing outstanding on it</span>
                  )}
                </dd>
                {bill.doc_no !== null && (
                  <>
                    <dt className="text-stone-500">Ours</dt>
                    <dd>
                      <span className={docNoCls}>{bill.doc_no}</span>
                    </dd>
                  </>
                )}
                <dt className="text-stone-500">Entered</dt>
                <dd className="text-stone-900">
                  {bill.entered_by ?? 'somebody'} · {fmtDateTime(bill.created_at)}
                </dd>
              </dl>

              <h4 className="mt-4 text-xs font-medium uppercase tracking-wide text-stone-400">
                {bill.lines.length} {bill.lines.length === 1 ? 'line' : 'lines'}
              </h4>
              {bill.lines.length === 0 ? (
                <Honesty verdict="no lines came back">
                  This bill totals {formatMoneyString(bill.bill_total)} and none of its lines arrived, so
                  nothing here can say what it was for. That is a failed read, not an empty bill.
                </Honesty>
              ) : (
                <ul className="mt-1.5 divide-y divide-rule-soft">
                  {bill.lines.map((l) => (
                    <li key={l.id} className="py-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-sm text-stone-800">
                          <span className={codeCls}>{l.item_code}</span> {l.item_name}
                        </span>
                        <span className="shrink-0 font-mono text-sm tabular-nums text-stone-900">
                          {formatMoneyString(l.amount)}
                        </span>
                      </div>
                      {/* THE ARITHMETIC IS SHOWN, not just its answer — this is
                          the screen somebody opens BECAUSE a figure looked
                          wrong, and qty × rate is where a wrong one lives. */}
                      <div className="text-xs text-stone-500">
                        {l.qty} {l.purchase_unit ?? ''} × {formatMoneyString(l.rate)}
                        {decimalStringToPaise(l.gst_amount) !== 0 && (
                          <> · GST {formatMoneyString(l.gst_amount)}</>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <dl className="mt-3 space-y-1 border-t border-rule pt-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-stone-500">Goods</dt>
                  <dd className="font-mono tabular-nums text-stone-700">
                    {formatMoneyString(bill.goods_total)}
                  </dd>
                </div>
                {/* SILENT AT ZERO. A GST line reading ₹0.00 on every bill in a
                    book that carries GST on the header is a row to read and
                    dismiss 330 times. */}
                {decimalStringToPaise(bill.gst_total) !== 0 && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-stone-500">GST</dt>
                    <dd className="font-mono tabular-nums text-stone-700">
                      {formatMoneyString(bill.gst_total)}
                    </dd>
                  </div>
                )}
                {decimalStringToPaise(bill.transport) !== 0 && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-stone-500">Transport</dt>
                    <dd className="font-mono tabular-nums text-stone-700">
                      {formatMoneyString(bill.transport)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-2 border-t border-rule-soft pt-1">
                  <dt className="font-medium text-stone-700">Bill total</dt>
                  <dd className="font-mono font-semibold tabular-nums text-stone-900">
                    {formatMoneyString(bill.bill_total)}
                  </dd>
                </div>
                {bill.unpaid !== null && decimalStringToPaise(bill.unpaid) > 0 && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-stone-500">Still unpaid</dt>
                    <dd className="font-mono tabular-nums text-amber-800">
                      {formatMoneyString(bill.unpaid)}
                    </dd>
                  </div>
                )}
              </dl>

              {bill.photos.length > 0 && (
                <>
                  <h4 className="mt-4 text-xs font-medium uppercase tracking-wide text-stone-400">
                    The paper
                  </h4>
                  {/* THE IMAGE ITSELF, SCALED — not a generated thumbnail.
                      Stage 1 of bill photos ruled out server-side image
                      processing and that ruling stands; what it did not rule
                      out is showing the picture, and every photo here was
                      compressed to about 200 KB in the browser before it was
                      ever uploaded. Anything that is not an image gets a row
                      rather than a broken frame.
                      The bytes come through our own route, which is where the
                      session, the matrix and the tenant prefix on the storage
                      key are all checked. */}
                  <ul className="mt-1.5 space-y-2">
                    {bill.photos.map((ph) => (
                      <li key={ph.id}>
                        {(ph.mime_type ?? '').startsWith('image/') ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/attachments/${ph.id}`}
                            alt={ph.filename ?? 'bill photograph'}
                            className="max-h-64 w-full rounded-lg border border-rule object-contain"
                          />
                        ) : (
                          <span className="text-sm text-stone-700">{ph.filename ?? 'a file'}</span>
                        )}
                        <span className="mt-0.5 block text-xs text-stone-400">
                          {ph.filename ?? 'photo'} · {kb(ph.byte_size)} · {ph.uploaded_by ?? 'somebody'} ·{' '}
                          {fmtDateTime(ph.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <p className="mt-4 border-t border-rule-soft pt-2 text-xs text-stone-400">
                Read-only. Nothing here can be edited or voided, and there is no way through to the bill
                page — this is a look at the paper, not a trip away from what you were doing.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
