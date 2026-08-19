'use client'

// The bill acknowledgement. It used to REPLACE the form and wait for a tap on
// "Enter another bill"; it now sits above a form that is already blank, and
// the tap is gone. A bookkeeper entering a stack of bills does this thirty
// times in a sitting.
//
// WHAT IS STILL MISSING, on a bill, is the masters born inline. An item
// created on the way past carries a name, a code and a unit and nothing
// else — so it has no reorder level, and the Reorder tab will never mention
// it. Said here, where the codes are on screen and the item pages are one
// tap away, rather than discovered as an empty reorder list in a month.

import type { SavedBill } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { docNoCls } from '@/components/ui'
import SaveAck, { type Missing } from '@/components/SaveAck'

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <dt className="text-stone-500">{label}</dt>
      <dd className="font-medium tabular-nums text-stone-900">{value}</dd>
    </div>
  )
}

export default function SaveReveal({ saved, onDismiss }: { saved: SavedBill; onDismiss: () => void }) {
  const { purchase, vendor, createdItems, dues } = saved
  const missing: Missing[] = []
  if (createdItems.length > 0) {
    missing.push({
      verdict: 'new items, bare',
      text: (
        <>
          {createdItems.map((i) => i.name).join(', ')} {createdItems.length === 1 ? 'was' : 'were'} created on this
          bill and {createdItems.length === 1 ? 'carries' : 'carry'} a name, a code and a unit — nothing else. With no
          reorder level {createdItems.length === 1 ? 'it' : 'they'} can never appear on the reorder list, and with no
          stock unit or conversion the count sheet reads in purchase units. Set them on the item page while you
          remember what {createdItems.length === 1 ? 'it is' : 'they are'}.
        </>
      ),
    })
  }

  return (
    <SaveAck
      onDismiss={onDismiss}
      headline={
        <>
          {vendor.name} · {purchase.lineCount} {purchase.lineCount === 1 ? 'line' : 'lines'} —{' '}
          <span className="tabular-nums">{formatMoneyString(purchase.billTotal)}</span>
        </>
      }
      sub={
        <>
          {fmtDate(purchase.billDate)}
          {/* the moment to write the number on the paper bill: it exists now,
              it is unique, and it survives even a later void */}
          {purchase.docNo !== null && (
            <>
              {' · '}
              <span className={docNoCls}>{purchase.docNo}</span>
            </>
          )}
        </>
      }
      missing={missing.length > 0 ? missing : undefined}
      actions={[{ href: `/store/books/bills/${purchase.id}`, label: 'See it in Books' }]}
    >
      <dl className="space-y-1">
        <Row label="Goods" value={formatMoneyString(purchase.goodsTotal)} />
        {decimalStringToPaise(purchase.gstTotal) !== 0 && (
          <Row label="GST" value={formatMoneyString(purchase.gstTotal)} />
        )}
        {decimalStringToPaise(purchase.transport) !== 0 && (
          <Row label="Transport" value={formatMoneyString(purchase.transport)} />
        )}
      </dl>

      <p className="mt-3 border-t border-emerald-200/60 pt-3 text-[15px] text-stone-900">
        {vendor.name} is now owed{' '}
        <span className="text-xl font-bold tabular-nums tracking-tight">{formatMoneyString(dues.balance)}</span>
        <span className="ml-1.5 text-xs text-stone-500">
          purchased {formatMoneyString(dues.purchased)} − paid {formatMoneyString(dues.paid)} · read live from
          vendor_dues
        </span>
      </p>

      {(vendor.created || createdItems.length > 0) && (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-emerald-200/60 pt-3">
          {vendor.created && (
            <li className="flex items-center gap-1.5 text-sm">
              <code className="rounded bg-stone-900 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white">
                {vendor.code}
              </code>
              <span className="text-stone-900">{vendor.name}</span>
              <span className="text-xs text-stone-400">new vendor</span>
            </li>
          )}
          {createdItems.map((it) => (
            <li key={it.id} className="flex items-center gap-1.5 text-sm">
              <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-700">
                {it.code}
              </code>
              <span className="text-stone-900">{it.name}</span>
              <span className="text-xs text-stone-400">new item</span>
            </li>
          ))}
        </ul>
      )}
    </SaveAck>
  )
}
