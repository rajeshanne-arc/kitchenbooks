import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getShortTotals, listShorts } from '@/server/shorts-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty from '@/components/Honesty'
import SettleShort from '@/components/store/SettleShort'
import { SHORT_KIND_LABELS, SHORT_SETTLEMENT_SHORT } from '@/components/store/shorts'
import {
  cardCls,
  dataTableCls,
  docNoCls,
  heroNumCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

// OPEN FIRST, and loudly. A short that nobody chases is not a short, it is a
// donation — so the unsettled ones lead the page with what they are worth,
// and the settled ones sit underneath, quiet, as history.

export default async function ShortsPage() {
  const restaurant = await getRestaurant()
  const [shorts, totals] = await Promise.all([listShorts(restaurant.id), getShortTotals(restaurant.id)])

  const open = shorts.filter((s) => s.settlement === 'open')
  const settled = shorts.filter((s) => s.settlement !== 'open')
  const recorded = totals.open_count + totals.settled_count

  // listShorts is capped, the totals are not. Counting the rows on screen and
  // printing that beside an uncapped rupee figure would state two different
  // truths in one sentence — so every COUNT comes from the totals, and the cap
  // is said out loud on the day it starts hiding rows.
  const hidden = recorded - shorts.length

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Shorts and damages</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what vendors billed and did not deliver, all time
        </p>
      </header>

      {recorded === 0 ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Nothing recorded</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            No short, damage or rejection has been recorded against any bill.
          </p>
          <div className="mt-3">
            <Honesty
              verdict="unasked"
              action={{ href: '/store/books/bills', label: 'Open a bill' }}
            >
              That can mean every delivery arrived complete, or that nobody has been recording them — this page cannot
              tell you which. A short is recorded on the bill itself, beside the line it happened on.
            </Honesty>
          </div>
        </section>
      ) : (
        <div className="space-y-4">
          {/* the red rule is the alarm, so it comes off when there is nothing
              to be alarmed about — a permanently red card stops being read */}
          <section
            className={totals.open_count === 0 ? cardCls : 'rounded-2xl border border-red-200 bg-cell p-4 sm:p-5'}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={sectionHeadCls}>
                {totals.open_count === 0 ? 'Open — none' : 'Open — nobody has chased these'}
              </h2>
              <span className="font-mono text-[10px] text-stone-400">purchase_line_shorts</span>
            </div>
            {totals.open_count === 0 ? (
              <p className="mt-1.5 text-sm text-stone-700">
                Every short on record has been settled one way or another. Nothing is outstanding with a vendor.
              </p>
            ) : (
              <>
                <p className={`mt-1 ${heroNumCls} text-[34px] text-red-700`}>
                  {formatMoneyString(totals.open_value)}
                </p>
                <p className="mt-1 text-sm text-stone-700">
                  across {totals.open_count} {totals.open_count === 1 ? 'line' : 'lines'}, valued at the rate on the
                  bill. This money is only recoverable while somebody is chasing it — a credit note nobody asks for is
                  never issued, and an unsettled short quietly becomes a cost we agreed to.
                </p>

                <div className="mt-3 overflow-x-auto">
                  <table className={dataTableCls}>
                    <thead>
                      <tr>
                        <th className={thCls}>Bill</th>
                        <th className={thCls}>Vendor</th>
                        <th className={thCls}>Item</th>
                        <th className={thCls}>Code</th>
                        <th className={thCls}>What</th>
                        <th className={thNumCls}>Billed</th>
                        <th className={thNumCls}>Arrived</th>
                        <th className={thNumCls}>Short</th>
                        <th className={thNumCls}>Worth</th>
                        <th className={thCls}>Chase it</th>
                      </tr>
                    </thead>
                    <tbody>
                      {open.map((s) => (
                        <tr key={s.id} className={trCls}>
                          <td className={tdCls}>
                            <Link href={`/store/books/bills/${s.purchase_id}`} className="hover:underline">
                              {fmtDate(s.bill_date)}
                            </Link>
                            {s.doc_no !== null && <div className={docNoCls}>{s.doc_no}</div>}
                          </td>
                          <td className={tdCls}>{s.vendor_name}</td>
                          <td className={tdCls}>{s.item_name}</td>
                          <td className={tdCodeCls}>{s.item_code}</td>
                          <td className={`${tdCls} text-[13px] text-stone-500`}>{SHORT_KIND_LABELS[s.kind]}</td>
                          <td className={`${tdNumCls} text-stone-500`}>{s.qty_billed}</td>
                          <td className={`${tdNumCls} text-stone-500`}>{s.qty_received}</td>
                          <td className={`${tdNumCls} font-semibold text-red-700`}>
                            {s.qty_short} <span className="font-normal text-stone-400">{s.purchase_unit}</span>
                          </td>
                          <td className={`${tdNumCls} font-semibold text-red-700`}>
                            {formatMoneyString(s.short_value)}
                          </td>
                          <td className={`${tdCls} min-w-[15rem] align-top`}>
                            <SettleShort
                              id={s.id}
                              settlement={s.settlement}
                              creditNoteRef={s.credit_note_ref}
                              note={s.note}
                              label="Chase it…"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          {totals.open_count > 0 && (
            <Honesty
              level="alarm"
              verdict="unchased"
              meter={{ filled: totals.settled_count, total: recorded, unit: 'shorts settled' }}
            >
              {totals.settled_count} of {recorded} recorded shorts have been settled. The rest are still an argument
              nobody has had with the vendor — {formatMoneyString(totals.open_value)} of it.
            </Honesty>
          )}

          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={sectionHeadCls}>Settled</h2>
              <span className="font-mono text-[10px] text-stone-400">
                {formatMoneyString(totals.settled_value)} over {totals.settled_count}
              </span>
            </div>
            {totals.settled_count === 0 ? (
              <p className="mt-1.5 text-sm text-stone-700">
                Nothing has been settled yet. When a credit note arrives, a replacement turns up, or the loss is
                absorbed, it is recorded against the short it answers.
              </p>
            ) : settled.length === 0 ? (
              <p className="mt-1.5 text-sm text-stone-700">
                {totals.settled_count} settled shorts are on record, all of them older than the {shorts.length} most
                recent rows this page loads. Open the bill to see one.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className={dataTableCls}>
                  <thead>
                    <tr>
                      <th className={thCls}>Bill</th>
                      <th className={thCls}>Vendor</th>
                      <th className={thCls}>Item</th>
                      <th className={thCls}>What</th>
                      <th className={thNumCls}>Short</th>
                      <th className={thNumCls}>Worth</th>
                      <th className={thCls}>Stands</th>
                      <th className={thCls}>Reference</th>
                      <th className={thCls} />
                    </tr>
                  </thead>
                  <tbody>
                    {settled.map((s) => (
                      <tr key={s.id} className={trCls}>
                        <td className={tdCls}>
                          <Link href={`/store/books/bills/${s.purchase_id}`} className="hover:underline">
                            {fmtDate(s.bill_date)}
                          </Link>
                        </td>
                        <td className={tdCls}>{s.vendor_name}</td>
                        <td className={tdCls}>{s.item_name}</td>
                        <td className={`${tdCls} text-[13px] text-stone-500`}>{SHORT_KIND_LABELS[s.kind]}</td>
                        <td className={`${tdNumCls} text-stone-500`}>
                          {s.qty_short} <span className="text-stone-400">{s.purchase_unit}</span>
                        </td>
                        <td className={`${tdNumCls} text-stone-500`}>{formatMoneyString(s.short_value)}</td>
                        <td className={tdCls}>{SHORT_SETTLEMENT_SHORT[s.settlement]}</td>
                        <td className={tdCodeCls}>{s.credit_note_ref ?? '—'}</td>
                        <td className={`${tdCls} min-w-[15rem] align-top`}>
                          <SettleShort
                            id={s.id}
                            settlement={s.settlement}
                            creditNoteRef={s.credit_note_ref}
                            note={s.note}
                            label="Amend"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {hidden > 0 && (
            <Honesty verdict="part shown" meter={{ filled: shorts.length, total: recorded, unit: 'shorts listed' }}>
              The tables above hold the {shorts.length} most recent shorts; {hidden} older{' '}
              {hidden === 1 ? 'one is' : 'ones are'} not on this page. Every figure stated in words counts all{' '}
              {recorded} — it is the rows that are cut, not the totals.
            </Honesty>
          )}

          <p className="text-[13px] text-stone-500">
            A short is recorded on the bill it happened on, beside the line — open{' '}
            <Link href="/store/books/bills" className="font-medium underline">
              a bill
            </Link>{' '}
            and the receiver&rsquo;s quantities are already there. What arrived is never edited: it is what stock and
            costs are built from.
          </p>
        </div>
      )}
    </>
  )
}
