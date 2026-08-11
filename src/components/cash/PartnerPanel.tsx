import Link from 'next/link'
import type { PartnerPanelRow } from '@/lib/types'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import {
  cardCls,
  dataTableCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import Honesty from '@/components/Honesty'

// The per-partner panel, with variance stated BOTH ways.
//
// The two are different findings and the screen refuses to collapse them:
//
//   the RUPEE GAP is billed − claimed — money we say we earned and they
//     have not accepted. It is an argument about one number.
//   the RATE is commission ÷ gross against the rate they agreed. It is an
//     argument about the deal, and it can be wrong while every individual
//     invoice reconciles perfectly.
//
// A small gap on a large period can hide a rate that drifted a point. A
// large gap can be one disputed invoice charged at exactly the agreed rate.
// Showing only one of them would answer the wrong question half the time.

export default function PartnerPanel({ rows }: { rows: PartnerPanelRow[] }) {
  if (rows.length === 0) {
    return (
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>No partners yet</h2>
        <p className="mt-1.5 text-sm text-stone-700">
          Add Swiggy, Zomato and anyone else who sells on your behalf below — with the commission you agreed,
          which is what every settlement is then measured against.
        </p>
      </section>
    )
  }

  const totalGap = rows.reduce((n, r) => n + decimalStringToPaise(r.gap), 0)
  const neverSettled = rows.filter((r) => r.settlements === 0)

  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Where each partner stands</h2>
        <span className="font-mono text-[10px] text-stone-400">partners · partner_settlements</span>
      </div>

      <div className="mt-2 overflow-x-auto">
        <table className={dataTableCls}>
          <thead>
            <tr>
              <th className={thCls}>Partner</th>
              <th className={thNumCls}>Agreed</th>
              <th className={thNumCls}>Effective</th>
              <th className={thNumCls}>Billed</th>
              <th className={thNumCls}>Claimed</th>
              <th className={thNumCls}>Gap</th>
              <th className={thNumCls}>Received</th>
              <th className={thNumCls}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const gap = decimalStringToPaise(r.gap)
              const agreed = r.agreed_pct === null ? null : Number(r.agreed_pct)
              const effective = r.effective_pct === null ? null : Number(r.effective_pct)
              // over half a point above the agreed rate is worth a colour;
              // below it is worth noticing too, so it is stated either way
              const drift = agreed !== null && effective !== null ? effective - agreed : null
              return (
                <tr key={r.partner} className={trCls}>
                  <td className={tdCls}>
                    <span className="font-medium">{r.partner}</span>
                    {r.kind !== null && (
                      <span className="ml-1.5 text-[11px] text-stone-500">{r.kind}</span>
                    )}
                  </td>
                  <td className={`${tdNumCls} text-stone-500`}>
                    {agreed === null ? <span className="font-sans text-xs text-amber-800">not set</span> : `${agreed}%`}
                  </td>
                  <td
                    className={`${tdNumCls} font-semibold ${
                      drift === null ? 'text-stone-500' : drift > 0.5 ? 'text-red-700' : 'text-stone-900'
                    }`}
                  >
                    {effective === null ? '—' : `${effective.toFixed(2)}%`}
                    {drift !== null && Math.abs(drift) >= 0.01 && (
                      <span className="ml-1 font-sans text-[11px] font-normal">
                        {drift > 0 ? '+' : ''}
                        {drift.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className={tdNumCls}>{formatMoneyString(r.billed)}</td>
                  <td className={tdNumCls}>{formatMoneyString(r.claimed)}</td>
                  <td
                    className={`${tdNumCls} font-semibold ${
                      gap > 0 ? 'text-red-700' : gap < 0 ? 'text-amber-800' : 'text-stone-400'
                    }`}
                  >
                    {gap === 0 ? '—' : formatMoneyString(r.gap)}
                  </td>
                  <td className={tdNumCls}>{formatMoneyString(r.received)}</td>
                  <td className={tdNumCls}>{formatMoneyString(r.outstanding)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-stone-600">
        <span className="font-medium">Two different questions.</span> The <span className="font-medium">gap</span>{' '}
        is billed minus claimed — money we say we earned and they have not accepted, an argument about one
        number. <span className="font-medium">Effective</span> is what they actually kept against the rate they
        agreed — an argument about the deal, which can be wrong while every individual invoice reconciles
        perfectly.
      </p>

      {totalGap !== 0 && (
        <div className="mt-2">
          <Honesty level="alarm" verdict="unaccepted" compact>
            {formatMoneyString((totalGap / 100).toFixed(2))} of what we billed has not been accepted across all
            partners.
          </Honesty>
        </div>
      )}

      {rows.some((r) => r.uncompared > 0) && (
        <div className="mt-2">
          <Honesty verdict="not compared" compact>
            Some settlements have only one side filled in. The gap above counts only the ones where both our
            figure and theirs are on file — a missing side is not a zero.
          </Honesty>
        </div>
      )}

      {neverSettled.length > 0 && (
        <p className="mt-2 text-xs text-amber-900">
          {neverSettled.map((r) => r.partner).join(', ')}{' '}
          {neverSettled.length === 1 ? 'has' : 'have'} never been reconciled — no settlement filed at all.
        </p>
      )}

      <Link
        href="/sales/partners#settlements"
        className="mt-3 inline-block text-xs font-medium text-emerald-700 hover:underline"
      >
        file a settlement below ↓
      </Link>
    </section>
  )
}
