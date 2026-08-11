import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getLadder, getOwnersOwed, listOtherIncome, listVouchers } from '@/server/cash-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function BooksCashPage() {
  const restaurant = await getRestaurant()
  const [ladder, owners, vouchers, income] = await Promise.all([
    getLadder(restaurant.id),
    getOwnersOwed(restaurant.id),
    listVouchers(restaurant.id),
    listOtherIncome(restaurant.id),
  ])

  return (
    <section className="mt-4 space-y-5">
      <div className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Day closes</h2>
          <span className="text-xs text-stone-400">latest filing per day wins · day_close_ladder</span>
        </div>
        {ladder.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            No day has been closed yet. The cashier closes the day under{' '}
            <Link href="/sales" className="font-medium text-emerald-700 hover:underline">
              Cash
            </Link>
            .
          </p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-[5.4rem_minmax(0,1fr)_5.4rem_5.4rem] gap-2 border-b border-stone-200 pb-1.5 sm:grid-cols-[6rem_minmax(0,1fr)_5.4rem_5.4rem_5.4rem]">
              <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Date</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400"></span>
              <span className="hidden text-right text-[11px] font-medium uppercase tracking-wide text-stone-400 sm:block">
                Expected
              </span>
              <span className="text-right text-[11px] font-medium uppercase tracking-wide text-stone-400">Counted</span>
              <span className="text-right text-[11px] font-medium uppercase tracking-wide text-stone-400">Diff</span>
            </div>
            <ul className="divide-y divide-rule-soft">
              {ladder.map((d) => {
                const diff = decimalStringToPaise(d.difference)
                return (
                  <li
                    key={d.close_date}
                    className="grid grid-cols-[5.4rem_minmax(0,1fr)_5.4rem_5.4rem] items-center gap-2 py-2.5 sm:grid-cols-[6rem_minmax(0,1fr)_5.4rem_5.4rem_5.4rem]"
                  >
                    <span className="text-sm text-stone-700">{fmtDate(d.close_date)}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                      {d.filings > 1 && (
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                          corrected ×{d.filings - 1}
                        </span>
                      )}
                      {decimalStringToPaise(d.handed_over) > 0 && (
                        <span>
                          handed {formatMoneyString(d.handed_over)}
                          {d.handed_to !== null && <> → {d.handed_to}</>}
                        </span>
                      )}
                      {d.bank_settled !== null && <span>bank {formatMoneyString(d.bank_settled)}</span>}
                    </span>
                    <span className="hidden text-right text-sm tabular-nums text-stone-600 sm:block">
                      {formatMoneyString(d.expected_cash)}
                    </span>
                    <span className="text-right text-sm tabular-nums text-stone-900">
                      {formatMoneyString(d.cash_counted)}
                    </span>
                    <span
                      className={`text-right text-sm font-semibold tabular-nums ${
                        diff === 0 ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {formatMoneyString(d.difference)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      <div className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Owners owed</h2>
          <span className="text-xs text-stone-400">one voucher log, netted · owners_owed</span>
        </div>
        {owners.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            No owner has paid from pocket yet. When one does, the debt appears here; reimburse it with a cashier
            voucher, category <code className="rounded bg-stone-100 px-1">owner_reimbursement</code> — it nets
            automatically and lands on that day’s ladder for free.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-rule-soft">
            {owners.map((o) => {
              const bal = decimalStringToPaise(o.balance)
              return (
                <li key={o.person} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium text-stone-900">{o.person}</span>
                    <span className="block text-xs tabular-nums text-stone-500">
                      paid {formatMoneyString(o.paid_from_pocket)} · reimbursed {formatMoneyString(o.reimbursed)}
                    </span>
                  </span>
                  <span
                    className={`text-right text-[15px] font-semibold tabular-nums ${
                      bal > 0 ? 'text-amber-800' : bal < 0 ? 'text-red-700' : 'text-stone-400'
                    }`}
                  >
                    {formatMoneyString(o.balance)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className={cardCls}>
        <h2 className={sectionHeadCls}>Vouchers</h2>
        {vouchers.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">Nothing paid out yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule-soft">
            {vouchers.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-stone-900">
                    {v.paid_to} <span className="text-stone-400">· {v.category}</span>
                  </span>
                  <span className="block text-xs text-stone-500">
                    {fmtDate(v.voucher_date)}
                    {v.paid_by === 'owner' && (
                      <span className="ml-1.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                        {v.owner_name} paid — not in the drawer
                      </span>
                    )}
                    {v.note !== null && <> · {v.note}</>}
                  </span>
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-stone-900">
                  {formatMoneyString(v.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={cardCls}>
        <h2 className={sectionHeadCls}>Other income</h2>
        {income.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">Nothing sold on the side yet — used oil will show up here.</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule-soft">
            {income.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-stone-900">
                    {i.item}
                    {i.qty !== null && (
                      <span className="text-stone-500">
                        {' '}
                        · {i.qty} {i.unit}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-stone-500">
                    {fmtDate(i.income_date)}
                    {i.buyer !== null && <> · to {i.buyer}</>}
                    {i.received_by !== null && <> · by {i.received_by}</>}
                  </span>
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-stone-900">
                  {formatMoneyString(i.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
