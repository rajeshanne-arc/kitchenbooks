// THE POSITION, AND EVERY ROW THAT PRODUCED IT.
//
// Two independent answers to one question sit on this screen: the ledger sums
// six movement tables, and `stock_on_hand` computes the same figure its own
// way. They must agree exactly, and the page SAYS whether they do.
//
// A SECOND SOURCE OF TRUTH THAT AGREES 99% OF THE TIME IS WORSE THAN NO SECOND
// SOURCE AT ALL — it teaches the reader to trust a number that is sometimes
// wrong. So a disagreement is an alarm, not a footnote, and it NAMES THE
// SUSPECT: the overwhelmingly likely cause is one of the six sources filtered
// by the wrong void convention. An alarm that names a suspicion is a diagnosis;
// one that says only "these differ" sends somebody hunting.

import Honesty from '@/components/Honesty'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import type { ItemLedgerRow } from '@/lib/types'
import {
  cardCls,
  dataTableCls,
  heroNumCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

/** Signed, and coloured only alongside the sign — never colour alone. */
function Qty({ v }: { v: string }) {
  const n = Number(v)
  return (
    <span className={n < 0 ? 'text-red-700' : 'text-stone-900'}>
      {n > 0 ? '+' : ''}
      {n}
    </span>
  )
}

const KIND_INK: Record<ItemLedgerRow['kind'], string> = {
  Purchase: 'text-emerald-800',
  Issue: 'text-stone-600',
  Return: 'text-emerald-800',
  Wastage: 'text-red-700',
  Adjustment: 'text-violet-700',
  'Vendor return': 'text-red-700',
}

export default function ItemLedger({
  rows,
  total,
  stock,
  unit,
}: {
  rows: ItemLedgerRow[]
  total: number
  stock: { on_hand_qty: string; on_hand_value: string; issue_cost: string | null } | null
  unit: string
}) {
  const onHand = Number(stock?.on_hand_qty ?? 0)
  const ledgerBalance = rows.length === 0 ? 0 : Number(rows[0].balance)
  // Compared as numbers, to the precision the database itself stores. A
  // tolerance here would be the thing that lets a real disagreement through.
  const ties = ledgerBalance === onHand

  return (
    <section className={cardCls}>
      <h3 className={sectionHeadCls}>Position</h3>

      <div className="mt-2 grid grid-cols-3 gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">On hand</div>
          <div className={`${heroNumCls} text-2xl ${onHand < 0 ? 'text-red-700' : 'text-stone-900'}`}>
            {onHand}
            <span className="ml-1 text-sm font-medium text-stone-500">{unit}</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Value</div>
          <div className={`${heroNumCls} text-2xl text-stone-900`}>
            {formatMoneyString(stock?.on_hand_value ?? '0')}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Weighted average</div>
          <div className={`${heroNumCls} text-2xl text-stone-900`}>
            {stock?.issue_cost === null || stock === null ? (
              <span className="text-base font-medium text-stone-400">no cost yet</span>
            ) : (
              formatMoneyString(stock.issue_cost)
            )}
          </div>
        </div>
      </div>

      {/* NEGATIVE STOCK IS SHOWN LOUDLY, never hidden or clamped. */}
      {onHand < 0 && (
        <div className="mt-3">
          <Honesty verdict="Below zero" level="alarm">
            More has left than ever arrived on record. A bill is probably missing — the ledger below shows
            every movement this figure is made of, oldest first.
          </Honesty>
        </div>
      )}

      {total === 0 ? (
        <p className="mt-3 text-sm text-stone-600">
          Nothing bought yet; the first bill starts this. Until then there is no position to report and no
          movements to list — which is the ordinary state of a new item, not a gap.
        </p>
      ) : (
        <>
          {/* THE RECONCILE LINE. Printed whether it agrees or not: a check that
              only appears when it fails is a check nobody knows is running. */}
          <div className="mt-3">
            {ties ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[13px] text-emerald-900">
                Balance reconciles to stock_on_hand · {onHand} {unit} ✓
                <span className="ml-1 text-emerald-800/70">
                  — {total} movement{total === 1 ? '' : 's'} summed here, and the same figure computed
                  independently by the view.
                </span>
              </p>
            ) : (
              <Honesty verdict="These do not agree" level="alarm">
                The ledger below adds up to <b>{ledgerBalance} {unit}</b> and stock_on_hand says{' '}
                <b>{onHand} {unit}</b>. Do not trust either until this is resolved.
                <br />
                <b>The likely cause is a void.</b> The six sources use TWO conventions: returns and vendor
                returns drop both halves of a reversed pair, while purchases, issues, wastage and
                adjustments keep both and let the negatives cancel. One source filtered the wrong way
                produces exactly this — a difference the size of one voided document, which reads like a
                rounding error and is not one.
              </Honesty>
            )}
          </div>

          <h3 className={`${sectionHeadCls} mt-4`}>Movements</h3>
          {total > rows.length && (
            <p className="mt-1 text-[13px] text-stone-500">
              The newest {rows.length} of {total}. The running balance is computed over ALL {total}, so the
              figures below are right even though the earliest rows are not shown.
            </p>
          )}

          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>What</th>
                  <th className={thCls}>Reference</th>
                  <th className={thNumCls}>Qty</th>
                  <th className={thNumCls}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row_id} className={trCls}>
                    <td className={tdCls}>{fmtDate(r.move_date)}</td>
                    <td className={`${tdCls} font-medium ${KIND_INK[r.kind]}`}>{r.kind}</td>
                    <td className={tdCls}>
                      <span className="text-stone-900">{r.ref}</span>
                      {r.party !== null && <span className="text-stone-500"> · {r.party}</span>}
                      {r.detail !== null && r.detail !== '' && (
                        <span className="block text-[12px] text-stone-500">{r.detail}</span>
                      )}
                    </td>
                    <td className={tdNumCls}>
                      <Qty v={r.signed_qty} />
                    </td>
                    <td className={`${tdNumCls} font-semibold`}>{Number(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* SAID ONCE, HERE, because both are natural mistakes: a count feels
              like a movement, and a short feels like goods that did not arrive. */}
          <p className="mt-2 text-[12px] text-stone-500">
            Counts and shorts are deliberately absent. A count records what was SEEN — the adjustment
            written when it is accepted is what moved the book, and listing both would double every
            correction. A short is recorded beside its bill because the bill&rsquo;s quantity already means
            what arrived.
          </p>
        </>
      )}
    </section>
  )
}
