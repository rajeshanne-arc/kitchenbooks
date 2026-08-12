import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getCount, getCountVariances, getIssueHistoryDays } from '@/server/counts-queries'
import { getAcceptanceContext, getCountAcceptance, listAdjustmentsForCount } from '@/server/adjustment-queries'
import AcceptCount from '@/components/store/AcceptCount'
import Honesty from '@/components/Honesty'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import {
  cardCls,
  dataTableCls,
  heroNumCls,
  sectionHeadCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

// The count, and the judgement that has or has not been made about it.
//
// Queries are deliberately staged rather than fanned out in one Promise.all:
// the group layout is already holding connections, and the acceptance
// branches decide which of the remaining reads are even needed.

export default async function CountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const [count, acceptance] = await Promise.all([
    getCount(restaurant.id, id),
    getCountAcceptance(restaurant.id, id),
  ])
  if (!count || !acceptance) notFound()
  const isAccepted = acceptance.accepted_at !== null

  const variances = await getCountVariances(restaurant.id, id)
  const adjustments = isAccepted ? await listAdjustmentsForCount(restaurant.id, id) : []
  // Only asked when it can still change what happens next.
  const warn = isAccepted
    ? null
    : {
        ...(await getAcceptanceContext(restaurant.id, id)),
        historyDays: await getIssueHistoryDays(restaurant.id),
      }

  const total = decimalStringToPaise(count.total_variance_value)

  return (
    <div className="mt-4 space-y-4">
      <Link href="/store/count" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Counts
      </Link>

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold text-stone-900">{fmtDate(count.count_date)}</h2>
          <span className="text-xs text-stone-400">saved {fmtDateTime(count.created_at)}</span>
        </div>
        {count.note !== null && <p className="mt-0.5 text-sm text-stone-500">{count.note}</p>}
        <p className={`mt-2 text-3xl ${heroNumCls} ${total < 0 ? 'text-red-700' : 'text-stone-900'}`}>
          {formatMoneyString(count.total_variance_value)}
        </p>
        <p className="mt-0.5 text-sm text-stone-500">
          total variance across {count.line_count} {count.line_count === 1 ? 'item' : 'items'} · book and cost frozen
          at count time
        </p>
      </section>

      {isAccepted ? (
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Accepted into the book</h2>
            <span className="text-xs text-stone-400">
              {acceptance.accepted_at !== null && fmtDateTime(acceptance.accepted_at)}
            </span>
          </div>
          <p className="mt-2 text-sm text-stone-700">
            {acceptance.accepted_by ?? 'Somebody'} decided the shelf was right and the book was wrong.{' '}
            {adjustments.length === 0 ? (
              <>
                Nothing needed correcting — that is a judgement too, and it says the book was already telling the
                truth.
              </>
            ) : (
              <>
                {adjustments.length} {adjustments.length === 1 ? 'correction' : 'corrections'} went into the book at
                the costs this count froze. They are events now: nothing can edit or delete them.
              </>
            )}
          </p>
          {adjustments.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Item</th>
                    <th className={thCls}>Code</th>
                    <th className={thNumCls}>Change</th>
                    <th className={thNumCls}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((a) => {
                    const short = decimalStringToPaise(a.value) < 0
                    return (
                      <tr key={a.id} className={trCls}>
                        <td className={tdCls}>{a.item_name}</td>
                        <td className={tdCodeCls}>{a.item_code}</td>
                        <td className={`${tdNumCls} ${short ? 'text-red-700' : 'text-stone-900'}`}>
                          {short ? a.qty : `+${a.qty}`} {a.purchase_unit}
                        </td>
                        <td className={`${tdNumCls} ${short ? 'text-red-700' : 'text-stone-900'}`}>
                          {formatMoneyString(a.value)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Link
            href="/store/adjustments"
            className="mt-3 inline-block text-sm font-medium text-emerald-700 underline underline-offset-2"
          >
            See the whole adjustment log →
          </Link>
        </section>
      ) : (
        <>
          {/* THE WARNING GOES BEFORE THE BUTTON. A first count on an
              established book absorbs months of missing paperwork in one
              stroke, and the person pressing accept is entitled to know that
              before they press it, not after. */}
          {warn !== null && (warn.prior === 0 || warn.historyDays < 14) && (
            <Honesty
              level="alarm"
              verdict={warn.prior === 0 ? 'first count' : 'thin history'}
              meter={
                warn.historyDays < 14
                  ? { filled: warn.historyDays, total: 14, unit: 'days of consumption on the book' }
                  : undefined
              }
            >
              {warn.prior === 0 ? (
                <>
                  This is the first count this book has ever had. Accepting will not find theft — it will absorb
                  everything that was never entered, every bill nobody typed and every issue nobody recorded, into
                  one correction per item.
                  {warn.historyDays < 14 && (
                    <>
                      {' '}
                      There are only {warn.historyDays} {warn.historyDays === 1 ? 'day' : 'days'} of consumption
                      behind the book, so that is most of what this figure is.
                    </>
                  )}{' '}
                  It is a fine way to start a book, as long as nobody reads the result as a loss.
                </>
              ) : (
                <>
                  Book stock has only {warn.historyDays} {warn.historyDays === 1 ? 'day' : 'days'} of consumption
                  behind it. Most of what these variances measure is paperwork that never arrived, not stock that
                  walked. Accept it if the shelf is right — just do not read the figure as a loss.
                </>
              )}
            </Honesty>
          )}

          {/* A count's line freezes the book as it stood that day, and the
              adjustment it writes is a DIFFERENCE. So two counts taken before
              either was accepted both claim the same difference, and a count
              whose book predates somebody else's acceptance has already had
              part of its difference put right. Either way the second
              acceptance is silent and reads like theft.

              Said, not blocked: refusing would strand the count — never
              acceptable, never off the waiting list. The judgement is the
              rule, so the person gets the fact and keeps the decision. */}
          {warn !== null && (warn.waiting > 0 || warn.correctedSince > 0) && (
            <Honesty level="alarm" verdict="risk of correcting twice">
              {warn.waiting > 0 && (
                <>
                  {warn.waiting === 1 ? 'Another count is' : `${warn.waiting} other counts are`} still waiting
                  {warn.oldestWaiting !== null && <> — the oldest from {fmtDate(warn.oldestWaiting)}</>}. A count
                  measures the difference against the book as it stood that day, so counts taken before either was
                  accepted all claim the SAME difference. Accepting more than one takes it off the book more than
                  once.{' '}
                </>
              )}
              {warn.correctedSince > 0 && (
                <>
                  {warn.correctedSince === 1 ? 'A count has' : `${warn.correctedSince} counts have`} been accepted
                  since this one was taken. This count&rsquo;s book figure was frozen before that correction landed,
                  so some of what it shows below has already been put right.{' '}
                </>
              )}
              Accept the count you believe and leave the{' '}
              {warn.waiting + warn.correctedSince === 1 ? 'other' : 'others'} — nothing is lost by not accepting one,
              and the shelf can always be counted again.
            </Honesty>
          )}

          <AcceptCount
            countId={id}
            varianceLines={acceptance.variance_lines}
            varianceValue={acceptance.variance_value}
          />
        </>
      )}

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>What was counted</h2>
          <span className="text-xs text-stone-400">worst shortage first</span>
        </div>
        <ul className="mt-2 divide-y divide-rule-soft">
          {variances.map((v) => {
            const neg = decimalStringToPaise(v.variance_value) < 0
            return (
              <li key={v.item_id} className={`py-2.5 ${neg ? 'rounded-lg bg-red-50 px-2' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className={`block truncate text-[15px] font-medium ${neg ? 'text-red-800' : 'text-stone-900'}`}>
                      {v.name} <span className="ml-1 font-mono text-[11px] font-normal text-stone-400">{v.code}</span>
                    </span>
                    <span className="block text-xs tabular-nums text-stone-500">
                      counted {v.counted_qty} · book {v.book_qty} {v.purchase_unit} · Δ {v.variance_qty} @{' '}
                      {formatMoneyString(v.unit_cost)}
                    </span>
                  </span>
                  <span className={`text-right text-[15px] font-semibold tabular-nums ${neg ? 'text-red-700' : 'text-stone-700'}`}>
                    {formatMoneyString(v.variance_value)}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
